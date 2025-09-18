import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { CreateConstraintsDto } from "./dto/create-constraints.dto";
import { UpdateConstraintsDto } from "./dto/update-constraints.dto";
import { PrismaService } from "../prisma/prisma.service";
import { validateConstraintsOverlaps } from "./validators/no-overlap";
import { validateNoIntersectIds } from "./validators/no-intersect-ids";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";

@Injectable()
export class ConstraintsService {
  constructor(private prisma: PrismaService) {}

  async create(
    {
      availableHours,
      batchSimilarTasks,
      minGapBetweenTasks,
      focusBlocks,
      maxDailyLoad,
    }: CreateConstraintsDto,
    userId: string
  ) {
    validateConstraintsOverlaps(availableHours, focusBlocks);
    try {
      const constraints = await this.prisma.constraints.create({
        data: {
          id: userId,
          availableHours: {
            createMany: {
              data: availableHours.map(({ start, end }) => ({ start, end })),
            },
          },
          batchSimilarTasks,
          minGapBetweenTasks,
          focusBlocks: {
            createMany: {
              data: focusBlocks.map(({ start, end, level }) => ({
                start,
                end,
                level,
              })),
            },
          },
          maxDailyLoad,
        },
        select: {
          focusBlocks: { orderBy: { start: "asc" } },
          availableHours: { orderBy: { start: "asc" } },
        },
      });
      return constraints;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError)
        if (error.code === PostgresErrorCode.UniqueConstraintViolation)
          throw new BadRequestException(
            "Constraint for the user already exists"
          );
      throw new InternalServerErrorException();
    }
  }

  async get(id: string) {
    const constraint = await this.prisma.constraints.findUnique({
      where: { id: id },
      include: { availableHours: true, focusBlocks: true },
    });
    if (!constraint) throw new NotFoundException();
    return constraint;
  }

  async update(
    id: string,
    {
      availableHours,
      deleteAvailableHoursIds,
      deleteFocusBlocksIds,
      focusBlocks,
      batchSimilarTasks,
      maxDailyLoad,
      minGapBetweenTasks,
      updateFocusBlocksDto,
      updateAvailableHoursDto,
    }: UpdateConstraintsDto
  ) {
    const existingConstraints = await this.get(id);
    if (!existingConstraints) throw new NotFoundException();
    validateConstraintsOverlaps(
      [
        ...(availableHours ?? []),
        ...existingConstraints.availableHours,
        ...(updateAvailableHoursDto ?? []),
      ],
      [
        ...(focusBlocks ?? []),
        ...existingConstraints.focusBlocks,
        ...(updateFocusBlocksDto ?? []),
      ]
    );

    const updateAvailableHoursIds = updateAvailableHoursDto?.map(
      (dto) => dto.id
    );
    const updateFocusBlockIds = updateFocusBlocksDto?.map((dto) => dto.id);

    validateNoIntersectIds(updateAvailableHoursIds, deleteAvailableHoursIds);
    validateNoIntersectIds(updateFocusBlockIds, deleteFocusBlocksIds);

    const updated = await this.prisma.constraints.update({
      where: { id },
      data: {
        batchSimilarTasks,
        maxDailyLoad,
        minGapBetweenTasks,
        availableHours: {
          deleteMany: deleteAvailableHoursIds
            ? deleteAvailableHoursIds.map((id) => ({ id }))
            : undefined,
          createMany: availableHours
            ? { data: availableHours.map(({ start, end }) => ({ start, end })) }
            : undefined,
          updateMany: updateAvailableHoursDto
            ? updateAvailableHoursDto.map(({ id, ...rest }) => ({
                where: { id },
                data: { ...rest },
              }))
            : undefined,
        },
        focusBlocks: focusBlocks
          ? {
              updateMany: updateFocusBlocksDto
                ? updateFocusBlocksDto.map(({ id, ...rest }) => ({
                    where: { id },
                    data: { ...rest },
                  }))
                : undefined,
              deleteMany: deleteFocusBlocksIds
                ? deleteFocusBlocksIds.map((id) => ({ id }))
                : undefined,
              createMany: {
                data: focusBlocks.map(({ start, end, level }) => ({
                  start,
                  end,
                  level,
                })),
              },
            }
          : undefined,
      },
    });
    return updated;
  }
}

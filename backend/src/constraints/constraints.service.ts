import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { CreateConstraintsDto } from "./dto/create-constraint.dto";
import { UpdateConstraintDto } from "./dto/update-constraint.dto";
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
      weekday,
    }: CreateConstraintsDto,
    userId: string
  ) {
    validateConstraintsOverlaps(availableHours, focusBlocks);
    try {
      const constraint = await this.prisma.constraint.create({
        data: {
          userId,
          weekday,
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
        include: {
          focusBlocks: { orderBy: { start: "asc" } },
          availableHours: { orderBy: { start: "asc" } },
        },
      });
      return constraint;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError)
        if (error.code === PostgresErrorCode.UniqueConstraintViolation)
          throw new BadRequestException(
            "Constraint for the user already exists"
          );
      throw new InternalServerErrorException();
    }
  }

  async getByWeekday(userId: string, weekday: number) {
    const constraint = await this.prisma.constraint.findUnique({
      where: { userId_weekday: { userId, weekday } },
      include: {
        availableHours: true,
        focusBlocks: true,
      },
    });
    if (!constraint) throw new NotFoundException();
    return constraint;
  }

  async getById(id: string, userId: string) {
    const constraint = await this.prisma.constraint.findUnique({
      where: { id, userId },
      include: {
        availableHours: true,
        focusBlocks: true,
      },
    });
    if (!constraint) throw new NotFoundException();
    return constraint;
  }

  async update(
    id: string,
    userId: string,
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
    }: UpdateConstraintDto
  ) {
    const existingConstraints = await this.getById(id, userId);
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

    const updated = await this.prisma.constraint.update({
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

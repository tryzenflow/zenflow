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
      energyBlocks,
      maxDailyLoad,
    }: CreateConstraintsDto,
    userId: string
  ) {
    validateConstraintsOverlaps(availableHours, energyBlocks);
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
          energyBlocks: {
            createMany: {
              data: energyBlocks.map(({ start, end, energyLevel }) => ({
                start,
                end,
                energyLevel,
              })),
            },
          },
          maxDailyLoad,
        },
        select: {
          energyBlocks: { orderBy: { start: "asc" } },
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
      include: { availableHours: true, energyBlocks: true },
    });
    if (!constraint) throw new NotFoundException();
    return constraint;
  }

  async update(
    id: string,
    {
      availableHours,
      deleteAvailableHoursIds,
      deleteEnergyBlocksIds,
      energyBlocks,
      batchSimilarTasks,
      maxDailyLoad,
      minGapBetweenTasks,
      updateEnergyBlocksDto,
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
        ...(energyBlocks ?? []),
        ...existingConstraints.energyBlocks,
        ...(updateEnergyBlocksDto ?? []),
      ]
    );

    const updateAvailableHoursIds = updateAvailableHoursDto?.map(
      (dto) => dto.id
    );
    const updateEnergyBlockIds = updateEnergyBlocksDto?.map((dto) => dto.id);

    validateNoIntersectIds(updateAvailableHoursIds, deleteAvailableHoursIds);
    validateNoIntersectIds(updateEnergyBlockIds, deleteEnergyBlocksIds);

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
        energyBlocks: energyBlocks
          ? {
              updateMany: updateEnergyBlocksDto
                ? updateEnergyBlocksDto.map(({ id, ...rest }) => ({
                    where: { id },
                    data: { ...rest },
                  }))
                : undefined,
              deleteMany: deleteEnergyBlocksIds
                ? deleteEnergyBlocksIds.map((id) => ({ id }))
                : undefined,
              createMany: {
                data: energyBlocks.map(({ start, end, energyLevel }) => ({
                  start,
                  end,
                  energyLevel,
                })),
              },
            }
          : undefined,
      },
    });
    return updated;
  }
}

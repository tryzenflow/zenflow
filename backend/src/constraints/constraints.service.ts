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
import { getWeekday } from "../common/utils";
import { getAvailableHours } from "./utils";

@Injectable()
export class ConstraintsService {
  constructor(private prisma: PrismaService) {}

  async create(
    {
      batchSimilarTasks,
      minGapBetweenTasks,
      focusBlocks,
      maxDailyLoad,
      weekday,
    }: CreateConstraintsDto,
    userId: string
  ) {
    validateConstraintsOverlaps(focusBlocks);
    try {
      const constraint = await this.prisma.constraint.create({
        data: {
          userId,
          weekday,
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
        },
      });
      return constraint;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError)
        if (error.code === PostgresErrorCode.UniqueConstraintViolation)
          throw new BadRequestException({
            success: false,
            message: "Constraint for the user already exists",
          });
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when creating a new constraint",
      });
    }
  }

  async getByWeekday(userId: string, weekday: number) {
    const constraint = await this.prisma.constraint.findUnique({
      where: { userId_weekday: { userId, weekday } },
      include: { focusBlocks: true },
    });
    if (!constraint)
      throw new NotFoundException({
        success: false,
        message: `Cannot find a constraint on ${getWeekday(weekday)}`,
      });
    return constraint;
  }

  async getById(id: string, userId: string) {
    const constraint = await this.prisma.constraint.findUnique({
      where: { id, userId },
      include: { focusBlocks: true },
    });
    if (!constraint) throw new NotFoundException();
    return constraint;
  }

  async update(
    id: string,
    userId: string,
    {
      deleteFocusBlocksIds,
      focusBlocks,
      batchSimilarTasks,
      maxDailyLoad,
      minGapBetweenTasks,
      updateFocusBlocksDto,
    }: UpdateConstraintDto
  ) {
    const existingConstraints = await this.getById(id, userId);
    if (!existingConstraints)
      throw new NotFoundException({
        success: false,
        message: `Cannot update constraint with id ${id} because it is not found`,
      });
    validateConstraintsOverlaps([
      ...(focusBlocks ?? []),
      ...existingConstraints.focusBlocks,
      ...(updateFocusBlocksDto ?? []),
    ]);

    const updateFocusBlockIds = updateFocusBlocksDto?.map((dto) => dto.id);

    validateNoIntersectIds(updateFocusBlockIds, deleteFocusBlocksIds);

    const updated = await this.prisma.constraint.update({
      where: { id },
      data: {
        batchSimilarTasks,
        maxDailyLoad,
        minGapBetweenTasks,
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

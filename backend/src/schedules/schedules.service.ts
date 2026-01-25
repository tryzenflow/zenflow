import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma";
import { minutesToUtc } from "../common/utils";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { ScheduledBlock } from "../scheduler/interfaces";
import { UpdateScheduledBlockDto } from "./dto/update-schedule.dto";
import { fromZonedTime } from "date-fns-tz";
import { DateRangeDto } from "src/common/dto/date-range.dto";
import { EnergyLearningService } from "src/energy-learning/energy-learning.service";
import { UserPreferencesService } from "src/prefs/prefs.service";

@Injectable()
export class SchedulesService {
  constructor(
    private prisma: PrismaService,
    private energyLearningService: EnergyLearningService,
    private userPreferencesService: UserPreferencesService,
  ) {}

  async findScheduledBlocks(
    userId: string,
    { start, end }: DateRangeDto,
    timezone: string,
  ) {
    const startDate = fromZonedTime(new Date(`${start}T00:00:00`), timezone);
    const endDate = fromZonedTime(new Date(`${end}T23:59:59`), timezone);
    const scheduledBlocks = await this.prisma.scheduledBlock.findMany({
      where: {
        task: { userId },
        start: { gte: startDate, lte: endDate },
        end: { gte: startDate, lte: endDate },
      },
      include: {
        task: { select: { title: true, energy: true } },
      },
    });
    return scheduledBlocks;
  }

  async schedule(
    date: string, // YYYY-MM-DD (local date)
    scheduledBlocks: ScheduledBlock[],
    timezone: string, // e.g. "Asia/Bangkok"
    userId: string,
  ) {
    const startDate = fromZonedTime(`${date}T00:00:00`, timezone);
    const endDate = fromZonedTime(`${date}T23:59:59`, timezone);
    const scheduled = await this.prisma.$transaction(async (tx) => {
      await tx.scheduledBlock.deleteMany({
        where: {
          start: { gte: startDate, lte: endDate },
          end: { gte: startDate, lte: endDate },
          task: { userId },
        },
      });
      const scheduled = await tx.scheduledBlock.createManyAndReturn({
        data: scheduledBlocks.map((block) => ({
          id: `${block.splitIndex}-${date}-${block.taskId}`,
          taskId: block.taskId,
          start: minutesToUtc(date, block.start || 0, timezone),
          end: minutesToUtc(date, block.end || 0, timezone),
          splitIndex: block.splitIndex || 0,
        })),
        include: {
          task: { select: { title: true, energy: true } },
        },
      });
      return scheduled.sort((a, b) => a.start.getTime() - b.start.getTime());
    });
    return scheduled;
  }

  async update(
    blockId: string,
    { start, end, date }: UpdateScheduledBlockDto,
    userId: string,
    timezone: string,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.scheduledBlock.update({
          where: { id: blockId, task: { userId } },
          data: {
            start: minutesToUtc(date, start, timezone),
            end: minutesToUtc(date, end, timezone),
          },
          select: { task: { select: { energy: true } } },
        });
        const startOfDay = fromZonedTime(`${date}T00:00:00`, timezone);
        const pref = await this.userPreferencesService.getByDay(
          userId,
          startOfDay.getDay(),
        );
        const newEnergyBlocks =
          this.energyLearningService.observeManualPlacement(
            pref.energyBlocks,
            start,
            end,
            updated.task.energy,
          );
        await this.userPreferencesService.update(
          startOfDay.getDay(),
          userId,
          { energyBlocks: newEnergyBlocks },
          tx,
        );
      });
    } catch (error) {
      if (error === PostgresErrorCode.RecordNotFound) {
        throw new NotFoundException({
          success: false,
          message: `Cannot update scheduled task because it does not exist`,
        });
      }
    }
  }

  async remove(blockId: string, userId: string) {
    try {
      await this.prisma.scheduledBlock.delete({
        where: { id: blockId, task: { userId } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException({
            success: false,
            message: `Cannot delete scheduled task because it does not exist`,
          });
      }

      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when trying to remove the schedule",
      });
    }
  }
}

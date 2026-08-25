import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateTaskResponse,
  RemoveTaskResponse,
  Task as SharedTask,
  TaskDetailResponse,
  TaskSuggestionsResponse,
  TasksListResponse,
  UpdateTaskResponse,
} from "@zenflow/shared";
import { Prisma, type User } from "../../generated/prisma";
import { minutesToUtc } from "../common/utils";
import { PostgresErrorCode } from "../prisma/error-codes";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { displayDayRange } from "../scheduler/utils/horizon";
import { ListTaskSuggestionsDto } from "./dto/list-task-suggestions.dto";
import { ListTasksDto } from "./dto/list-tasks.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { TagsService } from "../tags/tags.service";
import { TaskWithTags } from "./types";

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tagsService: TagsService,
  ) {}

  /** Map a Prisma row to the shared API shape (dates → ISO strings). */
  private toDto(task: TaskWithTags): SharedTask {
    return {
      id: task.id,
      title: task.title,
      note: task.note,
      durationMinutes: task.durationMinutes,
      deadline: task.deadline ? task.deadline.toISOString() : null,
      // The wire format stays a string[] of tag NAMES; sort for stable output.
      tags: task.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
      status: task.status,
      scheduledStartTime: task.scheduledStartTime
        ? task.scheduledStartTime.toISOString()
        : null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  async create(dto: CreateTaskDto, user: User): Promise<CreateTaskResponse> {
    const cleanTags = (dto.tags ?? []).map((t) => t.trim()).filter(Boolean);

    const created = await this.prisma.$transaction(async (tx) => {
      const tagIds = await this.tagsService.resolveTagIds(
        tx,
        user.id,
        cleanTags,
      );
      return tx.task.create({
        data: {
          title: dto.title,
          note: dto.note ?? null,
          durationMinutes: dto.durationMinutes,
          deadline: dto.deadline ? new Date(dto.deadline) : null,
          tags: { connect: tagIds.map((id) => ({ id })) },
          userId: user.id,
        },
        include: { tags: true },
      });
    });
    return this.toDto(created);
  }

  async list(dto: ListTasksDto, user: User): Promise<TasksListResponse> {
    const tz = user.timezone;
    const { startStr: displayStartStr, endStr: displayEndStr } =
      displayDayRange(dto.view, dto.date);
    const displayStart = minutesToUtc(displayStartStr, 0, tz);
    const displayEnd = minutesToUtc(displayEndStr, 1439, tz);

    const where: Prisma.TaskWhereInput = {
      userId: user.id,
      OR: [
        { scheduledStartTime: null },
        { scheduledStartTime: { gte: displayStart, lte: displayEnd } },
      ],
    };
    const tasks = await this.prisma.task.findMany({
      where,
      include: { tags: true },
    });

    return { tasks: tasks.map((t) => this.toDto(t)) };
  }

  async suggestions(
    dto: ListTaskSuggestionsDto,
    user: User,
  ): Promise<TaskSuggestionsResponse> {
    const limit = dto.limit ?? 10;
    const q = dto.q?.trim();

    const where: Prisma.TaskWhereInput = { userId: user.id };
    if (q) where.title = { contains: q, mode: "insensitive" };

    const rows = await this.prisma.task.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { tags: true },
      take: limit,
    });

    return { suggestions: rows.map((r) => this.toDto(r)) };
  }

  async findById(id: string, user: User): Promise<TaskDetailResponse> {
    const task = await this.prisma.task.findUnique({
      where: { id, userId: user.id },
      include: { tags: true },
    });
    if (!task) throw new NotFoundException(`Cannot find task with id ${id}`);

    return this.toDto(task);
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    user: User,
  ): Promise<UpdateTaskResponse> {
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.task.findFirst({
          where: { id, userId: user.id },
        });
        if (!existing)
          throw new NotFoundException(`Cannot find task with id ${id}`);

        const data: Prisma.TaskUpdateInput = {};
        if (dto.title !== undefined) data.title = dto.title;
        if (dto.note !== undefined) data.note = dto.note;
        if (dto.durationMinutes !== undefined)
          data.durationMinutes = dto.durationMinutes;
        if (dto.deadline !== undefined)
          data.deadline = dto.deadline ? new Date(dto.deadline) : null;
        if (dto.scheduledStartTime !== undefined)
          data.scheduledStartTime = dto.scheduledStartTime
            ? new Date(dto.scheduledStartTime)
            : null;
        if (dto.status !== undefined) data.status = dto.status;
        if (dto.tags !== undefined) {
          const cleanTags = dto.tags.map((t) => t.trim()).filter(Boolean);
          const tagIds = await this.tagsService.resolveTagIds(
            tx,
            user.id,
            cleanTags,
          );
          data.tags = { set: tagIds.map((tagId) => ({ id: tagId })) };
        }

        return tx.task.update({
          where: { id },
          data,
          include: { tags: true },
        });
      });

      return this.toDto(updated);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === (PostgresErrorCode.RecordNotFound as string)
      )
        throw new NotFoundException(`Cannot find task with id ${id}`);
      console.error(
        "[ERROR] service=tasks, method=update, message=Something went wrong when updating a task",
      );
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when updating a task",
      });
    }
  }

  async remove(id: string, user: User): Promise<RemoveTaskResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.task.findFirst({
          where: { id, userId: user.id },
        });
        if (!existing)
          throw new NotFoundException(`Cannot find task with id ${id}`);
        await tx.task.delete({ where: { id, userId: user.id } });
        return { id };
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === (PostgresErrorCode.RecordNotFound as string)
      )
        throw new NotFoundException(`Cannot find task with id ${id}`);
      console.error(
        `[ERROR] service=tasks, method=remove, message="${error.message}"`,
      );
      throw new InternalServerErrorException({
        success: false,
        message: "Something went wrong when deleting a task",
      });
    }
  }
}

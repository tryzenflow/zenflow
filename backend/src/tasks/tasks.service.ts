import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { Prisma } from "../../generated/prisma";
import { PostgresErrorCode } from "../prisma/error-codes";
import { validateTaskFields } from "./validators/task-fields";

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async create(
    { prerequisites = [], ...createTaskDto }: CreateTaskDto,
    userId: string
  ) {
    try {
      const errors = validateTaskFields({ prerequisites, ...createTaskDto });
      if (errors.length > 0) {
        throw new BadRequestException(errors);
      }
      const newTask = await this.prisma.task.create({
        data: {
          ...createTaskDto,
          prerequisites: { connect: prerequisites.map((p) => ({ id: p })) },
          userId,
        },
      });
      return newTask;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException();
        if (error.code === PostgresErrorCode.ForeignViolation)
          throw new BadRequestException(
            "Cannot create task because its associated category, prerequisites may not exist"
          );
      }
      throw new InternalServerErrorException();
    }
  }

  find(userId: string, taskIds?: string[]) {
    return this.prisma.task.findMany({
      where: { userId, id: { in: taskIds } },
      include: { prerequisites: true },
    });
  }

  async findById(id: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id, userId },
      include: {
        category: true,
        prerequisites: true,
      },
    });
    if (!task) throw new NotFoundException();
    return task;
  }

  async findUnscheduled(userId: string) {
    const unscheduledTasks = await this.prisma.task.findMany({
      where: {
        userId,
        schedules: { none: {} },
      },
      include: {
        category: true,
        prerequisites: true,
      },
    });
    return unscheduledTasks;
  }

  async update(
    id: string,
    { prerequisites, categoryId, ...updateTaskDto }: UpdateTaskDto,
    userId: string
  ) {
    try {
      const errors = validateTaskFields({
        prerequisites,
        categoryId,
        ...updateTaskDto,
      });
      if (errors.length > 0) {
        throw new BadRequestException(errors);
      }
      const updated = await this.prisma.task.update({
        where: { id, userId },
        data: {
          ...updateTaskDto,

          category: categoryId ? { connect: { id: categoryId } } : undefined,
          prerequisites: prerequisites
            ? { set: prerequisites?.map((p) => ({ id: p })) }
            : undefined,
        },
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException();
        if (error.code === PostgresErrorCode.ForeignViolation)
          throw new BadRequestException(
            "Cannot update task because its associated category, prerequisites may not exist"
          );
      }
      console.log(error);

      throw new InternalServerErrorException();
    }
  }

  async remove(id: string, userId: string) {
    try {
      await this.prisma.task.delete({
        where: { id, userId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PostgresErrorCode.RecordNotFound)
          throw new NotFoundException();
      }
      throw new InternalServerErrorException();
    }
  }
}

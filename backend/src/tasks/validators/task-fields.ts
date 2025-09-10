import { CreateTaskDto } from "../dto/create-task.dto";
import { UpdateTaskDto } from "../dto/update-task.dto";

export const validateTaskFields = (dto: CreateTaskDto | UpdateTaskDto) => {
  const errors: string[] = [];

  if (
    dto.earliestStart !== undefined &&
    dto.latestEnd !== undefined &&
    dto.duration &&
    dto.duration > dto.latestEnd - dto.earliestStart
  )
    errors.push(
      "Task duration must not be less than latestEnd - earliestStart"
    );

  if (
    dto.fixedStart !== undefined &&
    (dto.earliestStart !== undefined || dto.latestEnd !== undefined)
  )
    errors.push("Fixed-start task cannot have earliest start and latest end");

  if (
    dto.fixedStart !== undefined &&
    (dto.splittable || (dto.maxSplits !== undefined && dto?.maxSplits > 1))
  ) {
    errors.push("Fixed-start task cannot be splittable or have maxSplits > 1.");
  }

  // Non-splittable task cannot have maxSplits > 1
  if (!dto.splittable && dto.maxSplits !== undefined && dto.maxSplits > 1) {
    errors.push("Non-splittable task cannot have maxSplits > 1.");
  }

  return errors;
};

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

  return errors;
};

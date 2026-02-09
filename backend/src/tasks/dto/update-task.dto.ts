import { OmitType } from "@nestjs/mapped-types";
import { CreateTaskDto } from "./create-task.dto";

export class UpdateTaskDto extends OmitType(CreateTaskDto, ["scheduleDate"]) {}

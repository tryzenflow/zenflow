import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from "@nestjs/common";
import { ConstraintsService } from "./constraints.service";
import { CreateConstraintsDto } from "./dto/create-constraint.dto";
import { UpdateConstraintDto } from "./dto/update-constraint.dto";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";

@Controller("constraints")
@UseGuards(CookieAuthGuard)
export class ConstraintsController {
  constructor(private readonly constraintsService: ConstraintsService) {}

  @Post()
  create(
    @Body() createConstraintDto: CreateConstraintsDto,
    @CurrentUser() user: User
  ) {
    return this.constraintsService.create(createConstraintDto, user.id);
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() user: User) {
    return this.constraintsService.getById(id, user.id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() updateConstraintsDto: UpdateConstraintDto,
    @CurrentUser() user: User
  ) {
    return this.constraintsService.update(id, user.id, updateConstraintsDto);
  }
}

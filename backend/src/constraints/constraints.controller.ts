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
  async create(
    @Body() createConstraintDto: CreateConstraintsDto,
    @CurrentUser() user: User
  ) {
    const newConstraint = await this.constraintsService.create(
      createConstraintDto,
      user.id
    );
    return {
      success: true,
      message: "Create new constraint successfully",
      data: newConstraint,
    };
  }

  @Get()
  async get(@CurrentUser() user: User) {
    const constraints = await this.constraintsService.getAll(user.id);
    return {
      success: true,
      message: `Found ${constraints.length} constraints for user`,
      data: constraints,
    };
  }

  @Patch(":weekday")
  async update(
    @Param("weekday") weekday: number,
    @Body() updateConstraintsDto: UpdateConstraintDto,
    @CurrentUser() user: User
  ) {
    const updated = await this.constraintsService.update(
      weekday,
      user.id,
      updateConstraintsDto
    );
    return {
      success: true,
      message: `Update successfully constraint on ${weekday}`,
      data: updated,
    };
  }
}

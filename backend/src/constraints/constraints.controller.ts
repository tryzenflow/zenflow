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
import { CreateConstraintsDto } from "./dto/create-constraints.dto";
import { UpdateConstraintsDto } from "./dto/update-constraints.dto";
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

  @Get()
  get(@CurrentUser() user: User) {
    return this.constraintsService.get(user.id);
  }

  @Patch()
  update(
    @Body() updateConstraintsDto: UpdateConstraintsDto,
    @CurrentUser() user: User
  ) {
    return this.constraintsService.update(user.id, updateConstraintsDto);
  }
}

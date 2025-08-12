import { Controller, Put } from "@nestjs/common";
import { UpdateUserDto } from "./dto";
import { UsersService } from "./users.service";

@Controller("users")
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Put("/update/name")
  async updateName({ name }: UpdateUserDto, userId: number) {
    const updated = await this.usersService.updateName(userId, { name });
    return { success: true, user: updated };
  }
}

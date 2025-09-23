import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  HttpStatus,
} from "@nestjs/common";
import { createReadStream } from "fs";
import { join } from "path";
import { type Response } from "express";
import { LocalFilesService } from "./local-files.service";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { type User } from "../../generated/prisma";
import { LocalFilesInterceptor } from "./interceptors/local-files.interceptor";
import { RemoveFilesDto } from "./dto";

@Controller("files")
@UseGuards(CookieAuthGuard)
export class FilesController {
  constructor(private readonly filesService: LocalFilesService) {}

  @Post("upload")
  @UseInterceptors(
    LocalFilesInterceptor({
      fieldName: "files",
      limits: { fileSize: Math.pow(1024, 2) * 100 },
      maxFilesCount: 5,
    })
  )
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: User
  ) {
    const newFiles = await this.filesService.upload(
      files.map((f) => ({
        filename: f.filename,
        mimetype: f.path,
        path: f.path,
      })),
      user.id
    );
    return {
      success: true,
      message: "Uploaded files successfully",
      data: newFiles,
    };
  }

  @Delete("remove")
  async remove(@Query() { ids }: RemoveFilesDto, @CurrentUser() user: User) {
    await this.filesService.remove(ids, user.id);
    return { success: true, message: "Removed files successfully" };
  }

  @Get(":id")
  async stream(
    @Param("id") id: string,
    @CurrentUser() user: User,
    @Res({ passthrough: true }) response: Response
  ) {
    const file = await this.filesService.findOne(id, user.id);

    const stream = createReadStream(join(process.cwd(), file.path));

    response.set({
      "Content-Disposition": `inline; filename="${file.filename}"`,
      "Content-Type": file.mimetype,
    });
    return new StreamableFile(stream);
  }
}

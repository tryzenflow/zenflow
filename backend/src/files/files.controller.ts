import {
  Body,
  Controller,
  Inject,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { type Response } from "express";
import { type User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { RemoveFilesDto } from "./dto";
import { FILES_SERVICE, type FilesService } from "./files.service";
import { FilesUploadInterceptor } from "./interceptors/files-upload.interceptor";

@Controller("files")
@UseGuards(CookieAuthGuard)
export class FilesController {
  constructor(
    @Inject(FILES_SERVICE) private readonly filesService: FilesService,
  ) {}

  @Post("upload")
  @UseInterceptors(
    FilesUploadInterceptor({
      fieldName: "files",
      limits: { fileSize: Math.pow(1024, 2) * 100 },
      maxFilesCount: 5,
    }),
  )
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: User,
  ) {
    const newFiles = await this.filesService.upload(
      files.map((f) => ({
        originalName: f.originalname,
        filename: f.filename,
        size: f.size,
        mimetype: f.mimetype,
        path: f.path,
      })),
      user.id,
    );
    return {
      success: true,
      message: "Uploaded files successfully",
      data: newFiles,
    };
  }

  @Post("remove")
  async remove(@Body() { ids }: RemoveFilesDto, @CurrentUser() user: User) {
    await this.filesService.remove(ids, user.id);
    return { success: true, message: "Removed files successfully" };
  }

  @Get("metadata/:id")
  async getMetadata(@Param("id") id: string, @CurrentUser() user: User) {
    const metadata = await this.filesService.getMetadata(id, user.id);
    return { success: true, data: metadata };
  }

  @Get(":id")
  async stream(
    @Param("id") id: string,
    @CurrentUser() user: User,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { file, stream } = await this.filesService.download(id, user.id);

    response.set({
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      "Content-Type": file.mimetype,
    });
    return new StreamableFile(stream);
  }
}

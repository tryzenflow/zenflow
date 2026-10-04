import {
  Body,
  Controller,
  Inject,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { type Request, type Response } from "express";
import { type User } from "../../generated/prisma";
import { CookieAuthGuard } from "../auth/guards";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { RemoveFilesDto } from "./dto";
import { FileUrlSignerService } from "./file-url-signer.service";
import { FILES_SERVICE, type FilesService } from "./files.service";
import { FilesUploadInterceptor } from "./interceptors/files-upload.interceptor";

@Controller("files")
export class FilesController {
  constructor(
    @Inject(FILES_SERVICE) private readonly filesService: FilesService,
    private readonly signer: FileUrlSignerService,
  ) {}

  @Post("upload")
  @UseGuards(CookieAuthGuard)
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
      data: newFiles.map((f) => ({ ...f, url: this.signer.url(f.id) })),
    };
  }

  @Post("remove")
  @UseGuards(CookieAuthGuard)
  async remove(@Body() { ids }: RemoveFilesDto, @CurrentUser() user: User) {
    await this.filesService.remove(ids, user.id);
    return { success: true, message: "Removed files successfully" };
  }

  @Get("metadata/:id")
  @UseGuards(CookieAuthGuard)
  async getMetadata(@Param("id") id: string, @CurrentUser() user: User) {
    const metadata = await this.filesService.getMetadata(id, user.id);
    return {
      success: true,
      data: { ...metadata, url: this.signer.url(metadata.id) },
    };
  }

  /**
   * Serves file content. Either a valid `?sig=` (capability URL, no session
   * needed — for WebView `<img>` embeds) or a cookie session that owns the file.
   * An invalid/missing signature falls through to the cookie check.
   */
  @Get(":id")
  async stream(
    @Param("id") id: string,
    @Query("sig") sig: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const signed = this.signer.verify(id, sig);
    let userId: string | undefined;
    if (!signed) {
      if (!request.isAuthenticated()) throw new UnauthorizedException();
      userId = (request.user as User).id;
    }
    const { file, stream } = await this.filesService.download(id, userId);

    response.set({
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      "Content-Type": file.mimetype,
      // Uploaded content is user-controlled: never let it sniff into HTML/JS.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      // Signed URLs are stable but must revalidate so removing a file takes
      // effect even for browsers that already fetched it.
      "Cache-Control": signed ? "private, no-cache" : "private, max-age=3600",
    });
    return new StreamableFile(stream);
  }
}

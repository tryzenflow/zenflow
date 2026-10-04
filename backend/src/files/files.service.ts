import { Readable } from "stream";
import { UploadFileDto } from "./dto";
import { File } from "../../generated/prisma";

export const FILES_SERVICE = Symbol("FILES_SERVICE");

export interface UploadFilesResponse {
  id: string;
  originalName: string;
  mimetype: string;
  size: number;
}

export interface FilesService {
  upload(
    uploadFilesDto: UploadFileDto[],
    userId: string,
  ): Promise<UploadFilesResponse[]>;
  findOne(id: string, userId: string): Promise<File | null>;
  remove(keys: string[], userId: string): Promise<void>;
  getMetadata(id: string, userId: string): Promise<UploadFilesResponse>;
  download(
    id: string,
    userId: string,
  ): Promise<{ file: File; stream: Readable }>;
}

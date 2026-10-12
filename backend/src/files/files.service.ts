import { Readable } from "stream";
import { ByteRange } from "./byte-range";
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
  /** `userId` undefined skips the ownership check (signed-URL path only). */
  findOne(id: string, userId?: string): Promise<File | null>;
  remove(keys: string[], userId: string): Promise<void>;
  /** Total `File.size` stored by the user. */
  usedBytes(userId: string): Promise<number>;
  getMetadata(id: string, userId: string): Promise<UploadFilesResponse>;
  /** `rangeHeader` is the raw `Range` request header; `range` is set for a partial response. */
  download(
    id: string,
    userId?: string,
    rangeHeader?: string,
  ): Promise<{ file: File; stream: Readable; range: ByteRange | null }>;
}

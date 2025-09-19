import { UploadFileDto } from "./dto";
import { File } from "../../generated/prisma";

interface UploadFilesResponse {
  id: string;
  mimetype: string;
}

export interface FilesService {
  upload(
    uploadFilesDto: UploadFileDto[],
    userId: string
  ): Promise<UploadFilesResponse[]>;
  findOne(id: string, userId: string): Promise<File | null>;
  remove(keys: string[], userId: string): Promise<void>;
}

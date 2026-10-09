import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { map, type Observable } from "rxjs";
import { NoteFilesService } from "../files/note-files.service";

/**
 * Adds `?sig=` to the file references in every `note` of a sessions response
 * (single, `sessions[]`, `suggestions[]`, …). Notes are stored without it.
 */
@Injectable()
export class SignNoteFilesInterceptor implements NestInterceptor {
  constructor(private readonly noteFiles: NoteFilesService) {}

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => this.walk(body)));
  }

  private walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((v) => this.walk(v));
    if (value === null || typeof value !== "object" || value instanceof Date)
      return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        k === "note" && typeof v === "string"
          ? this.noteFiles.sign(v)
          : this.walk(v);
    }
    return out;
  }
}

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FileUrlSignerService } from "./file-url-signer.service";
import {
  canonicalFileUrl,
  extractNoteFileIds,
  rewriteNoteFileRefs,
  type NoteFileRef,
} from "./note-file-refs";

/** Replacement for a reference to a file the author does not own. */
const DROPPED_URL = "#";

/** Converts note HTML between its stored form (no `sig`) and its wire form. */
@Injectable()
export class NoteFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: FileUrlSignerService,
  ) {}

  /** Ours: a relative reference, or an absolute one carrying a valid sig. A
   * look-alike on another host (e.g. the LMS `/api/v1/files/…`) is not. */
  private isOurs(ref: NoteFileRef): boolean {
    return !ref.absolute || this.signer.verify(ref.id, ref.sig);
  }

  /** Wire form: every file reference carries a fresh `?sig=`. */
  sign(note: string): string;
  sign(note: string | null): string | null;
  sign(note: string | null): string | null {
    if (!note) return note;
    return rewriteNoteFileRefs(note, (ref) =>
      this.isOurs(ref) ? this.signer.url(ref.id) : undefined,
    );
  }

  /**
   * Stored form: sigs stripped, and references to files `userId` does not own
   * neutralised so read-time signing cannot mint access to someone else's file.
   */
  async normalize(
    note: string | null | undefined,
    userId: string,
  ): Promise<string | null | undefined> {
    if (!note) return note;
    const ids = extractNoteFileIds(note);
    if (ids.length === 0) return note;
    const owned = new Set(
      (
        await this.prisma.file.findMany({
          where: { id: { in: ids }, userId },
          select: { id: true },
        })
      ).map((f) => f.id),
    );
    return rewriteNoteFileRefs(note, (ref) => {
      if (!this.isOurs(ref)) return undefined;
      return owned.has(ref.id) ? canonicalFileUrl(ref.id) : DROPPED_URL;
    });
  }
}

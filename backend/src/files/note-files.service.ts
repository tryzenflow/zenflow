import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FILES_SERVICE, type FilesService } from "./files.service";
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
  private readonly logger = new Logger(NoteFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: FileUrlSignerService,
    @Inject(FILES_SERVICE) private readonly files: FilesService,
  ) {}

  /** Ids of every file referenced by one of `userId`'s session notes. */
  private async referencedIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.session.findMany({
      where: { userId, note: { contains: "/files/" } },
      select: { note: true },
    });
    const ids = new Set<string>();
    for (const { note } of rows) {
      if (!note) continue;
      // Only our own refs: a look-alike on another host is not a file of ours.
      rewriteNoteFileRefs(note, (ref) => {
        if (this.isOurs(ref)) ids.add(ref.id);
        return undefined;
      });
    }
    return ids;
  }

  /**
   * Runs a session mutation, then deletes the files it left unreferenced:
   * those in the user's notes before `fn` and in none after. Because both
   * sides are read from the whole account, a file still linked from another
   * session (or series sibling) is never removed, and only ids that were
   * actually referenced are candidates. Cleanup is best-effort and runs after
   * the mutation commits; a failure leaves an orphan, never breaks the call.
   */
  async releasingUnreferenced<T>(
    userId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    let before: Set<string>;
    try {
      before = await this.referencedIds(userId);
    } catch (err) {
      this.logger.warn(`file cleanup skipped: ${(err as Error).message}`);
      return fn();
    }
    const result = await fn();
    if (before.size === 0) return result;
    try {
      const after = await this.referencedIds(userId);
      const orphaned = [...before].filter((id) => !after.has(id));
      if (orphaned.length > 0) await this.files.remove(orphaned, userId);
    } catch (err) {
      this.logger.warn(`file cleanup failed: ${(err as Error).message}`);
    }
    return result;
  }

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

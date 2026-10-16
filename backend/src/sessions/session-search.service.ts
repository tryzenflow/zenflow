import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  Session as SharedSession,
  SessionSearchDirection,
  SessionSearchResponse,
} from "@zenflow/shared";
import { Prisma, type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { expandRrule, occurrenceId } from "../scheduler/core/recurrence";
import { DAY_MS } from "../scheduler/core/slot";
import { SearchSessionsDto } from "./dto/search-sessions.dto";
import { WITH_TAGS_AND_SERIES } from "./types/session-row";
import { toSessionDto } from "./session-mapper";
import {
  OCCURRENCE_WINDOW_DAYS,
  type SearchPosition,
  decodeCursor,
  encodeCursor,
  isPast,
  likePattern,
  mergePage,
  searchTerms,
} from "./utils/session-search";

type Hit = SearchPosition & { dto: SharedSession };

/**
 * `GET /sessions/search`: sessions whose title, note text, location or a tag
 * contains every word of `q`, paged by `(start, id)` from an anchor instant.
 * Stored rows come from SQL backed by the `pg_trgm` indexes; a recurring
 * fixed series is matched on its representative row and fanned out into
 * virtual occurrences up to the last stored row of the page, or
 * {@link OCCURRENCE_WINDOW_DAYS} past the cursor once stored rows run out.
 * Unscheduled rows are skipped.
 */
@Injectable()
export class SessionSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    dto: SearchSessionsDto,
    user: User,
  ): Promise<SessionSearchResponse> {
    const direction: SessionSearchDirection = dto.direction ?? "forward";
    const limit = dto.limit ?? 20;
    const cursor = this.position(dto);
    const match = this.matchSql(searchTerms(dto.q));

    const stored = await this.storedPage(user, match, cursor, direction, limit);
    const storedHasMore = stored.length > limit;
    const storedPage = stored.slice(0, limit);
    const last = storedPage.at(-1);
    const windowMs = OCCURRENCE_WINDOW_DAYS * DAY_MS;
    const bound =
      storedHasMore && last
        ? last.start
        : new Date(
            cursor.start.getTime() +
              (direction === "forward" ? windowMs : -windowMs),
          );
    const occurrences = await this.occurrences(
      user,
      match,
      cursor,
      bound,
      direction,
      limit,
    );

    const { page, hasMore } = mergePage(
      storedPage,
      occurrences,
      limit,
      direction,
      storedHasMore,
    );
    const tail = page.at(-1);
    if (direction === "backward") page.reverse();
    return {
      sessions: page.map((h) => h.dto),
      nextCursor: hasMore && tail ? encodeCursor(tail) : null,
    };
  }

  private position(dto: SearchSessionsDto): SearchPosition {
    if (dto.cursor) {
      const p = decodeCursor(dto.cursor);
      if (!p) throw new BadRequestException("Invalid cursor");
      return p;
    }
    return { start: dto.anchor ? new Date(dto.anchor) : new Date(), id: "" };
  }

  /** Every term must hit the title, note text (tags stripped), location or a tag name, ignoring accents. */
  private matchSql(terms: string[]): Prisma.Sql {
    if (terms.length === 0) return Prisma.sql`TRUE`;
    return Prisma.join(
      terms.map((term) => {
        const p = Prisma.sql`immutable_unaccent(${likePattern(term)}::text)`;
        return Prisma.sql`(
          immutable_unaccent(s."title") ILIKE ${p}
          OR immutable_unaccent(s."location") ILIKE ${p}
          OR (immutable_unaccent(s."note") ILIKE ${p}
              AND immutable_unaccent(regexp_replace(s."note", '<[^>]*>', ' ', 'g')) ILIKE ${p})
          OR EXISTS (
            SELECT 1 FROM "_SessionToTag" st
            JOIN "Tag" t ON t."id" = st."B"
            WHERE st."A" = s."id" AND immutable_unaccent(t."name") ILIKE ${p}
          )
        )`;
      }),
      " AND ",
    );
  }

  /** Up to `limit + 1` plain rows past `cursor`, in walk order. */
  private async storedPage(
    user: User,
    match: Prisma.Sql,
    cursor: SearchPosition,
    direction: SessionSearchDirection,
    limit: number,
  ): Promise<Hit[]> {
    const at = Prisma.sql`(${cursor.start.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
    const past =
      direction === "forward"
        ? Prisma.sql`(s."scheduledStartTime" > ${at}
            OR (s."scheduledStartTime" = ${at} AND s."id" COLLATE "C" > ${cursor.id}))`
        : Prisma.sql`(s."scheduledStartTime" < ${at}
            OR (s."scheduledStartTime" = ${at} AND s."id" COLLATE "C" < ${cursor.id}))`;
    const order =
      direction === "forward"
        ? Prisma.sql`s."scheduledStartTime" ASC, s."id" COLLATE "C" ASC`
        : Prisma.sql`s."scheduledStartTime" DESC, s."id" COLLATE "C" DESC`;
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s."id" FROM "Session" s
      LEFT JOIN "SessionSeries" ss ON ss."id" = s."seriesId"
      WHERE s."userId" = ${user.id}
        AND s."deleted" = false
        AND s."scheduledStartTime" IS NOT NULL
        AND ss."rrule" IS NULL
        AND ${past}
        AND ${match}
      ORDER BY ${order}
      LIMIT ${limit + 1}`;
    if (ids.length === 0) return [];
    const rows = await this.prisma.session.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: WITH_TAGS_AND_SERIES,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap(({ id }) => {
      const row = byId.get(id);
      if (!row?.scheduledStartTime) return [];
      return [{ start: row.scheduledStartTime, id, dto: toSessionDto(row) }];
    });
  }

  /** Matching recurring series' occurrences between `cursor` and `bound`, at most `limit + 1` per series. */
  private async occurrences(
    user: User,
    match: Prisma.Sql,
    cursor: SearchPosition,
    bound: Date,
    direction: SessionSearchDirection,
    limit: number,
  ): Promise<Hit[]> {
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s."id" FROM "Session" s
      JOIN "SessionSeries" ss ON ss."id" = s."seriesId"
      WHERE s."userId" = ${user.id}
        AND s."deleted" = false
        AND s."scheduledStartTime" IS NOT NULL
        AND ss."rrule" IS NOT NULL
        AND ${match}`;
    if (ids.length === 0) return [];
    const reps = await this.prisma.session.findMany({
      where: { id: { in: ids.map((r) => r.id) } },
      include: WITH_TAGS_AND_SERIES,
    });

    const [from, to] =
      direction === "forward" ? [cursor.start, bound] : [bound, cursor.start];
    const hits: Hit[] = [];
    for (const rep of reps) {
      if (!rep.seriesId || !rep.series?.rrule || !rep.scheduledStartTime)
        continue;
      const base = toSessionDto(rep);
      const seriesId = rep.seriesId;
      let starts = expandRrule(
        rep.series.rrule,
        rep.scheduledStartTime,
        from,
        new Date(to.getTime() + 1),
        user.timezone,
        rep.series.exdates,
      )
        .map((start) => ({ start, id: occurrenceId(seriesId, start) }))
        .filter((p) => isPast(p, cursor, direction));
      starts =
        direction === "forward"
          ? starts.slice(0, limit + 1)
          : starts.slice(-(limit + 1));
      for (const p of starts) {
        hits.push({
          ...p,
          dto: { ...base, id: p.id, scheduledStartTime: p.start.toISOString() },
        });
      }
    }
    return hits;
  }
}

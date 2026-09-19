import { Injectable } from "@nestjs/common";
import type {
  CreateSessionResponse,
  RemoveSessionResponse,
  RemoveSessionSeriesResponse,
  SessionDetailResponse,
  SessionSuggestionsResponse,
  SessionsListResponse,
  SlotPickResponse,
  UpdateSessionResponse,
} from "@zenflow/shared";
import { type User } from "../../generated/prisma";
import { CreateSessionDto } from "./dto/create-session.dto";
import { ListSessionSuggestionsDto } from "./dto/list-session-suggestions.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { SlotPickDto } from "./dto/slot-pick.dto";
import { SessionCrudService } from "./session-crud.service";
import { SeriesService } from "./series.service";
import { SessionUpdateService } from "./session-update.service";
import { SlotPickService } from "./slot-pick.service";
import { RemindersService } from "../reminders/reminders.service";

/**
 * Thin facade the controller calls — its 10 methods delegate to the collaborator
 * services, one concern each:
 *  - {@link SessionCrudService}   create / list / suggestions / findById / remove
 *  - {@link SessionUpdateService} `PATCH /sessions/:id`
 *  - {@link SeriesService}        every `SessionSeries` lifecycle op
 *  - {@link SlotPickService}      `POST /sessions/:id/slot-pick`
 *
 * The wire contract is unchanged — see `sessions.controller.ts`.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly crud: SessionCrudService,
    private readonly series: SeriesService,
    private readonly updates: SessionUpdateService,
    private readonly slotPickService: SlotPickService,
    private readonly reminders: RemindersService,
  ) {}

  /**
   * Reminders are persisted right after the row(s) exist (default: one at 60
   * min for non-DND; explicit list/[] honoured) and the response is stamped
   * with them. Validation runs first so a bad request inserts nothing.
   */
  async create(
    dto: CreateSessionDto,
    user: User,
  ): Promise<CreateSessionResponse> {
    const minutes = this.reminders.resolveForCreate(dto.type, dto.reminders);
    const res = await this.crud.create(dto, user);
    const ids = res.sessions?.length ? res.sessions.map((s) => s.id) : [res.id];
    await this.reminders.replace(ids, minutes);
    res.reminders = minutes;
    res.sessions?.forEach((s) => (s.reminders = minutes));
    await this.reminders.syncUser(user.id);
    return res;
  }

  list(dto: ListSessionsDto, user: User): Promise<SessionsListResponse> {
    return this.crud.list(dto, user);
  }

  suggestions(
    dto: ListSessionSuggestionsDto,
    user: User,
  ): Promise<SessionSuggestionsResponse> {
    return this.crud.suggestions(dto, user);
  }

  findById(id: string, user: User): Promise<SessionDetailResponse> {
    return this.crud.findById(id, user);
  }

  async update(
    id: string,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<UpdateSessionResponse> {
    const target =
      dto.reminders !== undefined
        ? await this.reminders.resolveUpdateTargets(id, dto.reminders, user)
        : null;
    const res = await this.updates.update(id, dto, user);
    if (target) {
      await this.reminders.replace(target.sessionIds, target.minutes);
      res.reminders = target.minutes;
      res.sessions?.forEach((s) => {
        if (target.sessionIds.includes(s.id)) s.reminders = target.minutes;
      });
    } else if (dto.sessionCount !== undefined && res.seriesId) {
      // New sittings of a grown series inherit the series' reminders.
      await this.reminders.propagateSeries(res.seriesId);
    }
    await this.reminders.syncUser(user.id);
    return res;
  }

  async remove(id: string, user: User): Promise<RemoveSessionResponse> {
    const res = await this.crud.remove(id, user);
    await this.reminders.syncUser(user.id);
    return res;
  }

  async slotPick(
    id: string,
    dto: SlotPickDto,
    user: User,
  ): Promise<SlotPickResponse> {
    const res = await this.slotPickService.recordPick(id, dto, user);
    await this.reminders.syncUser(user.id); // a pick can move the session
    return res;
  }

  async truncateSeriesFrom(
    seriesId: string,
    fromStartISO: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    const res = await this.series.truncateFrom(seriesId, fromStartISO, user);
    await this.reminders.syncUser(user.id);
    return res;
  }

  async removeSeries(
    seriesId: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    const res = await this.series.removeSeries(seriesId, user);
    await this.reminders.syncUser(user.id);
    return res;
  }

  async removeSeriesFrom(
    seriesId: string,
    sessionId: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    const res = await this.series.removeFrom(seriesId, sessionId, user);
    await this.reminders.syncUser(user.id);
    return res;
  }
}

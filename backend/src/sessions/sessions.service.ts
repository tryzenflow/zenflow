import { Injectable } from "@nestjs/common";
import type {
  CreateSessionResponse,
  RemoveSessionResponse,
  RemoveSessionSeriesResponse,
  SessionDetailResponse,
  SessionSuggestionsResponse,
  SessionsListResponse,
  UpdateSessionResponse,
} from "@zenflow/shared";
import { type User } from "../../generated/prisma";
import { CreateSessionDto } from "./dto/create-session.dto";
import { ListSessionSuggestionsDto } from "./dto/list-session-suggestions.dto";
import { ListSessionsDto } from "./dto/list-sessions.dto";
import { UpdateSessionDto } from "./dto/update-session.dto";
import { SessionCrudService } from "./session-crud.service";
import { SeriesService } from "./series.service";
import { SessionUpdateService } from "./session-update.service";

/**
 * Thin facade the controller calls — its 9 methods delegate to the collaborator
 * services, one concern each:
 *  - {@link SessionCrudService}   create / list / suggestions / findById / remove
 *  - {@link SessionUpdateService} `PATCH /sessions/:id`
 *  - {@link SeriesService}        every `SessionSeries` lifecycle op
 *
 * The wire contract is unchanged — see `sessions.controller.ts`.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly crud: SessionCrudService,
    private readonly series: SeriesService,
    private readonly updates: SessionUpdateService,
  ) {}

  create(dto: CreateSessionDto, user: User): Promise<CreateSessionResponse> {
    return this.crud.create(dto, user);
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

  update(
    id: string,
    dto: UpdateSessionDto,
    user: User,
  ): Promise<UpdateSessionResponse> {
    return this.updates.update(id, dto, user);
  }

  remove(id: string, user: User): Promise<RemoveSessionResponse> {
    return this.crud.remove(id, user);
  }

  truncateSeriesFrom(
    seriesId: string,
    fromStartISO: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    return this.series.truncateFrom(seriesId, fromStartISO, user);
  }

  removeSeries(
    seriesId: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    return this.series.removeSeries(seriesId, user);
  }

  removeSeriesFrom(
    seriesId: string,
    sessionId: string,
    user: User,
  ): Promise<RemoveSessionSeriesResponse> {
    return this.series.removeFrom(seriesId, sessionId, user);
  }
}

import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from "class-validator";

interface FeasibleTaskWindowHost {
  type?: string;
  durationMinutes?: number;
  sessionCount?: number;
}

/**
 * Coarse feasibility guard on a `TASK` create (issue #33): rejects when
 * `now + durationMinutes × sessionCount > deadline` — there isn't even enough
 * raw time between now and the deadline to fit every sitting back-to-back,
 * before the request ever reaches the scheduler.
 *
 * This is a NECESSARY, not sufficient, check (no working hours, no existing
 * occupancy, no per-day cap) — it exists to reject the obviously-impossible
 * case cheaply, at the DTO boundary. The placer's own pre-flight
 * ({@link TaskPlacementService.canPlaceTask} / `canPlaceSeries`, in
 * `SessionCrudService.create`) still runs afterwards and catches the "the
 * arithmetic fits but every day between now and the deadline is already
 * full" case this one can't see.
 */
@ValidatorConstraint({ name: "IsFeasibleTaskWindow", async: false })
export class IsFeasibleTaskWindowConstraint implements ValidatorConstraintInterface {
  validate(deadline: unknown, args: ValidationArguments) {
    const o = args.object as FeasibleTaskWindowHost;
    if (o.type !== "TASK") return true; // only a TASK carries a deadline at all
    if (typeof deadline !== "string" || Number.isNaN(Date.parse(deadline)))
      return true; // malformed/missing deadline is @IsISO8601's job to report
    if (
      typeof o.durationMinutes !== "number" ||
      Number.isNaN(o.durationMinutes)
    )
      return true; // its own @IsInt/@Min decorators report this

    const sessionCount = Math.max(1, Math.trunc(o.sessionCount ?? 1));
    const neededMs = o.durationMinutes * sessionCount * 60_000;
    return Date.now() + neededMs <= Date.parse(deadline);
  }

  /**
   * A `"\n"` splits a short title from its description — the mobile client's
   * `splitToastMessage` renders the two as separate toast lines instead of
   * one long wrapped, bold one.
   */
  defaultMessage(args: ValidationArguments) {
    const o = args.object as FeasibleTaskWindowHost;
    const sessionCount = Math.max(1, Math.trunc(o.sessionCount ?? 1));
    return sessionCount > 1
      ? `Can't fit ${sessionCount} sessions before the deadline\nLoosen the deadline or reduce the number of sessions.`
      : `Won't fit before the deadline\nPick a later deadline.`;
  }
}

/** Attach to `CreateSessionDto.deadline`, alongside `@IsISO8601()`. */
export function IsFeasibleTaskWindow(validationOptions?: ValidationOptions) {
  return function (object: Record<string, any>, propertyName: string) {
    registerDecorator({
      name: "IsFeasibleTaskWindow",
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsFeasibleTaskWindowConstraint,
    });
  };
}

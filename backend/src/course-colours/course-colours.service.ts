import { BadRequestException, Injectable } from "@nestjs/common";
import {
  COURSE_COLOUR_SWATCH_COUNT,
  type CourseColour,
  type CourseColourResponse,
  type CourseColoursResponse,
} from "@zenflow/shared";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";

/** `lms:<Moodle course id>` or `portal:<ScheduleStudyUnitID>`. */
export const COURSE_KEY_PATTERN = /^(lms|portal):[A-Za-z0-9._:-]{1,110}$/;

/** A user's per-course colour picks (issue #238). */
@Injectable()
export class CourseColoursService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: User): Promise<CourseColoursResponse> {
    const rows = await this.prisma.courseColour.findMany({
      where: { userId: user.id },
      orderBy: { courseKey: "asc" },
      select: { courseKey: true, swatch: true },
    });
    return { colours: rows };
  }

  async set(
    user: User,
    courseKey: string,
    swatch: number,
  ): Promise<CourseColourResponse> {
    assertCourseKey(courseKey);
    assertSwatch(swatch);
    const row: CourseColour = await this.prisma.courseColour.upsert({
      where: { userId_courseKey: { userId: user.id, courseKey } },
      create: { userId: user.id, courseKey, swatch },
      update: { swatch },
      select: { courseKey: true, swatch: true },
    });
    return row;
  }

  /** Drops the pick so the course goes back to its automatic colour. */
  async reset(user: User, courseKey: string): Promise<{ courseKey: string }> {
    assertCourseKey(courseKey);
    await this.prisma.courseColour.deleteMany({
      where: { userId: user.id, courseKey },
    });
    return { courseKey };
  }
}

export function assertCourseKey(courseKey: string): void {
  if (!COURSE_KEY_PATTERN.test(courseKey)) {
    throw new BadRequestException("Invalid course key");
  }
}

export function assertSwatch(swatch: number): void {
  if (
    !Number.isInteger(swatch) ||
    swatch < 0 ||
    swatch >= COURSE_COLOUR_SWATCH_COUNT
  ) {
    throw new BadRequestException("Swatch must be 0 to 11");
  }
}

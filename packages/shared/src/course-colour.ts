/** Number of course colour swatches. A swatch is an index `0` to `11`. */
export const COURSE_COLOUR_SWATCH_COUNT = 12;

/**
 * A user's own colour pick for one course. Courses without a pick use the
 * automatic colour derived from `courseKey` in `@zenflow/core`.
 *
 * `courseKey` is `lms:<Moodle course id>` for a Moodle course and
 * `portal:<ScheduleStudyUnitID>` for a portal course section.
 */
export interface CourseColour {
  courseKey: string;
  swatch: number;
}

/** `data` of `GET /course-colours`. */
export interface CourseColoursResponse {
  colours: CourseColour[];
}

/** Body of `PUT /course-colours/:courseKey`. */
export interface UpdateCourseColourInput {
  swatch: number;
}

/** `data` of `PUT /course-colours/:courseKey`. */
export type CourseColourResponse = CourseColour;

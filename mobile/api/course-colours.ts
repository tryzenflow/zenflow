import type {
  CourseColour,
  CourseColourResponse,
  CourseColoursResponse,
} from "@zenflow/shared";
import { api } from "./base";

/** The user's course colour picks. */
export async function listCourseColours(): Promise<CourseColour[]> {
  const { data } = await api.get<{ data: CourseColoursResponse }>(
    "/course-colours",
  );
  return data.data.colours;
}

/** Save a pick. The key is URL-encoded because it contains `:`. */
export async function setCourseColour(
  courseKey: string,
  swatch: number,
): Promise<CourseColourResponse> {
  const { data } = await api.put<{ data: CourseColourResponse }>(
    `/course-colours/${encodeURIComponent(courseKey)}`,
    { swatch },
  );
  return data.data;
}

/** Drop a pick so the course goes back to its automatic colour. */
export async function resetCourseColour(courseKey: string): Promise<void> {
  await api.delete(`/course-colours/${encodeURIComponent(courseKey)}`);
}

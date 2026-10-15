import type { StudentMarksResponse, StudentResponse } from "@zenflow/shared";
import { api } from "./base";

/** The student's DLU profile; `profile` is null until the first fetch lands. */
export async function getStudent(): Promise<StudentResponse> {
  const { data } = await api.get("/users/me/student");
  return data.data;
}

/** Marks grouped by term, newest first. */
export async function getMarks(): Promise<StudentMarksResponse> {
  const { data } = await api.get("/users/me/marks");
  return data.data;
}

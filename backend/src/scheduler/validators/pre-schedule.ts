import { ScheduleRequest } from "../interfaces";

export function validatePreSchedule(body: ScheduleRequest): string[] {
  const errors: any[] = [];
  const tasks = body.tasks;

  // --- 1. Fixed task overlaps
  const fixed = tasks.filter(
    (t) =>
      t.earliestStart &&
      t.latestEnd &&
      t.latestEnd - t.earliestStart === t.duration
  );
  for (let i = 0; i < fixed.length; i++) {
    const t1 = fixed[i];
    if (!t1.mandatory) continue;
    const end1 = t1.earliestStart! + t1.duration;
    for (let j = i + 1; j < fixed.length; j++) {
      const t2 = fixed[j];
      if (!t2.mandatory) continue;
      const end2 = t2.earliestStart! + t2.duration;
      if (!(end1 <= t2.earliestStart! || end2 <= t1.earliestStart!)) {
        errors.push(`Task "${t1.title}" overlaps with task "${t2.title}".`);
      }
    }
  }

  // --- 2. Prerequisite cycles
  const graph = new Map<string, string[]>();
  for (const t of tasks) {
    graph.set(t.id, t.prerequisites ?? []);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();

  const dfs = (id: string): boolean => {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    for (const dep of graph.get(id) ?? []) {
      if (dfs(dep)) return true;
    }
    stack.delete(id);
    return false;
  };

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (dfs(t.id)) {
      errors.push(`Task "${t.title}" has cyclic prerequisites.`);
    }
  }

  // --- 3. Prerequisite mandatory
  const tasksMap = new Map<string, { title: string; mandatory: boolean }>();
  for (const t of tasks) {
    tasksMap.set(t.id, { title: t.title, mandatory: t.mandatory });
  }

  for (const t of tasks) {
    for (const p of t.prerequisites) {
      const prerequisiteTask = tasksMap.get(p);
      if (!prerequisiteTask || (!prerequisiteTask.mandatory && t.mandatory))
        errors.push(
          `Mandatory task "${t.title}" depends on task "${tasksMap.get(p)!.title}", which may be excluded or optional`
        );
    }
  }

  return errors;
}

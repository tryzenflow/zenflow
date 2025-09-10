// pre-schedule-validation.pipe.ts
import { ScheduleRequest } from "../scheduler.service";

export function validatePreSchedule(body: ScheduleRequest): string[] {
  const errors: any[] = [];
  const tasks = body.tasks;
  const constraints = body.constraints;

  // --- 1. Fixed task overlaps
  const fixed = tasks.filter((t) => t.fixedStart !== undefined);
  for (let i = 0; i < fixed.length; i++) {
    const t1 = fixed[i];
    const end1 = t1.fixedStart! + t1.duration;
    for (let j = i + 1; j < fixed.length; j++) {
      const t2 = fixed[j];
      const end2 = t2.fixedStart! + t2.duration;
      if (!(end1 <= t2.fixedStart! || end2 <= t1.fixedStart!)) {
        errors.push(`Task "${t1.title}" overlaps with task "${t2.title}".`);
      }
    }
  }

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t.splittable && t.maxSplits > 1) {
      errors.push(`Non-splittable task cannot have max splits > 1.`);
    }
    if (t.fixedStart !== undefined && (t.splittable || t.maxSplits > 1)) {
      errors.push(`Fixed-start task cannot be splittable.`);
    }
  }

  // --- 5. Prerequisite cycles
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

  return errors;
}

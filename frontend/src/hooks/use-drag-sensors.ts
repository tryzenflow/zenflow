import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";

/**
 * Sensors for the calendar drag-and-drop. The 8px activation distance means a
 * plain click (pointer down + up with no real movement) never starts a drag —
 * so tapping or double-clicking a task card opens it instead of registering a
 * spurious "move" to whatever time slot happened to sit under the pointer.
 */
export function useDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
}

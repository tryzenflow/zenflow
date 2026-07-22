import type { BottomSheetModalMethods } from "@gorhom/bottom-sheet/lib/typescript/types";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";

/**
 * Drives a @gorhom/bottom-sheet v5 `BottomSheetModal` from an external
 * boolean `open` flag — `present()`/`dismiss()` are imperative, not
 * prop-controlled, so every task sheet (`CreateTaskSheet`, `EditTaskSheet`,
 * `ChangeDurationSheet`) needs this same bridge. Also centralizes the
 * "haptic on sheet open" requirement (RN migration Phase 5 / GitHub issue
 * #20 checklist) so every sheet gets it for free instead of each one
 * re-implementing the `Haptics.impactAsync` call.
 */
export function useControlledBottomSheet(open: boolean) {
  const ref = useRef<BottomSheetModalMethods>(null);

  useEffect(() => {
    if (open) {
      ref.current?.present();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else {
      ref.current?.dismiss();
    }
  }, [open]);

  return ref;
}

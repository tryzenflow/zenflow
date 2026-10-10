import type { ReactNode } from "react";

/** Swipe-to-act stand-in: swipes aren't simulated, so the right-hand actions render inline. */
export default function Swipeable({
  children,
  renderRightActions,
}: {
  children?: ReactNode;
  renderRightActions?: () => ReactNode;
}) {
  return (
    <div>
      {children}
      {renderRightActions?.()}
    </div>
  );
}
export type SwipeableMethods = { close: () => void; openRight: () => void };

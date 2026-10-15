import { waitFor } from "@testing-library/react";
import { expect } from "vitest";

/** Waits until no skeleton is on screen: content renders after a paint and a short hold. */
export async function waitForContent() {
  await waitFor(() =>
    expect(document.querySelector('[data-testid$="skeleton"]')).toBeNull(),
  );
}

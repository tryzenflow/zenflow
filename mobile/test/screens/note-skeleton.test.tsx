import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoteSkeleton } from "@/components/tasks/note-skeleton";

describe("NoteSkeleton", () => {
  it("renders the placeholder lines", () => {
    render(<NoteSkeleton />);
    expect(screen.getByTestId("note-skeleton").children).toHaveLength(5);
  });

  it("renders fewer lines on request", () => {
    render(<NoteSkeleton lines={2} />);
    expect(screen.getByTestId("note-skeleton").children).toHaveLength(2);
  });
});

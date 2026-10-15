import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { GettingStarted } from "@/components/checklist/getting-started";
import { useUserStore } from "@/hooks/use-user-store";
import { testUser } from "@/test/msw/handlers";
import { renderScreen } from "@/test/utils/render";

function signedIn(seenTips: string[]) {
  useUserStore.setState({
    user: { ...testUser, seenTips: seenTips as never } as never,
    loading: false,
  });
}

beforeEach(() => {
  signedIn([]);
});

describe("GettingStarted", () => {
  it("shows the pill with no steps done", () => {
    renderScreen(<GettingStarted />);
    expect(screen.getByLabelText("Getting started, 0 of 3 done")).toBeTruthy();
  });

  it("shows progress as done of total once a step is ticked", () => {
    signedIn(["connect-dlu"]);
    renderScreen(<GettingStarted />);
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("hides once the user hides the checklist", () => {
    signedIn(["checklist-hidden"]);
    renderScreen(<GettingStarted />);
    expect(screen.queryByTestId("getting-started.pill")).toBeNull();
  });

  it("hides once every step is done", () => {
    signedIn(["connect-dlu", "add-task", "finish-session"]);
    renderScreen(<GettingStarted />);
    expect(screen.queryByTestId("getting-started.pill")).toBeNull();
  });

  it("lists the three steps when the pill is opened", () => {
    renderScreen(<GettingStarted />);
    fireEvent.click(screen.getByLabelText("Getting started, 0 of 3 done"));
    expect(screen.getByText("Connect DLU")).toBeTruthy();
    expect(screen.getByText("Add a task")).toBeTruthy();
    expect(screen.getByText("Finish a session")).toBeTruthy();
  });
});

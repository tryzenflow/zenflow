import { fireEvent, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppTabBar } from "@/components/tab-bar";
import { renderScreen } from "@/test/utils/render";


const routes = [
  { key: "index-k", name: "index" },
  { key: "today-k", name: "today" },
  { key: "settings-k", name: "settings" },
];
const titles: Record<string, string> = { index: "Calendar", today: "Today", settings: "Me" };

const emitter = { emit: vi.fn(() => ({ defaultPrevented: false })) };
const navigateToTab = vi.fn();

function bar(index: number) {
  const props = {
    state: { index, routes },
    descriptors: Object.fromEntries(
      routes.map((r) => [
        r.key,
        { options: { title: titles[r.name], tabBarIcon: () => <i /> } },
      ]),
    ),
    emitter,
    navigateToTab,
  };
  return <AppTabBar {...(props as unknown as ComponentProps<typeof AppTabBar>)} />;
}

beforeEach(() => {
  emitter.emit.mockReturnValue({ defaultPrevented: false });
});

describe("AppTabBar", () => {
  it("renders a labelled tab per route", () => {
    renderScreen(bar(1));
    for (const title of Object.values(titles)) expect(screen.getByLabelText(title)).toBeTruthy();
    expect(screen.getByTestId("tab.today")).toBeTruthy();
    expect(screen.queryByLabelText("Month")).toBeNull();
  });

  it("emits tabPress and navigates when another tab is tapped", () => {
    renderScreen(bar(0));
    fireEvent.click(screen.getByTestId("tab.settings"));
    expect(emitter.emit).toHaveBeenCalledWith({
      type: "tabPress",
      target: "settings-k",
      canPreventDefault: true,
    });
    expect(navigateToTab).toHaveBeenCalledWith("settings-k");
  });

  it("does not navigate when the focused tab is tapped again", () => {
    renderScreen(bar(0));
    fireEvent.click(screen.getByTestId("tab.index"));
    expect(navigateToTab).not.toHaveBeenCalled();
  });

  it("respects a screen that prevents the tab press", () => {
    emitter.emit.mockReturnValue({ defaultPrevented: true });
    renderScreen(bar(0));
    fireEvent.click(screen.getByTestId("tab.today"));
    expect(navigateToTab).not.toHaveBeenCalled();
  });
});

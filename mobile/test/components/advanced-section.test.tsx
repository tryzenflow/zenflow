import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AdvancedSection } from "@/components/settings/advanced-section";
import { useUserStore } from "@/hooks/use-user-store";
import { testUser } from "@/test/msw/handlers";
import { renderScreen } from "@/test/utils/render";

beforeEach(() => {
  useUserStore.setState({
    user: { ...testUser, lang: "en", timezone: "Asia/Ho_Chi_Minh" } as never,
    loading: false,
  });
});

describe("AdvancedSection", () => {
  it("is collapsed by default, hiding timezone and storage", () => {
    renderScreen(<AdvancedSection />);
    expect(screen.getByRole("button", { name: "Advanced" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.queryByText("Asia/Ho_Chi_Minh")).toBeNull();
  });

  it("reveals the timezone when expanded", async () => {
    renderScreen(<AdvancedSection />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(await screen.findByText("Asia/Ho_Chi_Minh")).toBeTruthy();
  });
});

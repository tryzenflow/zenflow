import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { DluAccountsSection } from "@/components/settings/dlu-accounts-section";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

const status = (provider: "LMS" | "PORTAL", extra: Record<string, unknown> = {}) =>
  ({ provider, connected: false, ...extra }) as never;

function seed(...integrations: unknown[]) {
  useIntegrationStore.setState({ integrations: integrations as never[], loading: false });
}

const toastShown = (text: string) =>
  waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));

beforeEach(() => {
  seed(status("LMS"), status("PORTAL"));
});

describe("DluAccountsSection — connecting", () => {
  it("offers Connect for each account that isn't connected", () => {
    renderScreen(<DluAccountsSection />);
    expect(screen.getAllByText("Not connected")).toHaveLength(2);
    expect(screen.getAllByText("Connect")).toHaveLength(2);
  });

  it("signs in with the student ID and password, then shows the account connected", async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/integrations`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          data: status("LMS", { connected: true, lastSuccessAt: new Date().toISOString() }),
        });
      }),
    );
    renderScreen(<DluAccountsSection />);
    fireEvent.click(screen.getAllByText("Connect")[0]);
    fireEvent.change(await screen.findByPlaceholderText("2112345"), {
      target: { value: "  2112345  " },
    });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "hunter2" } });
    const sheet = screen.getByText("Sign in to your LMS").closest("[role=dialog]") as HTMLElement;
    fireEvent.click(within(sheet).getByText("Connect"));
    await waitFor(() => expect(body).toEqual({ provider: "LMS", username: "2112345", password: "hunter2" }));
    await toastShown("Connected");
    expect(useIntegrationStore.getState().integrations[0]).toMatchObject({
      provider: "LMS",
      connected: true,
    });
  });

  it("explains rejected credentials and stays on the sheet", async () => {
    server.use(http.post(`${API}/integrations`, () => HttpResponse.json({}, { status: 400 })));
    renderScreen(<DluAccountsSection />);
    fireEvent.click(screen.getAllByText("Connect")[0]);
    fireEvent.change(await screen.findByPlaceholderText("2112345"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "x" } });
    const sheet = screen.getByText("Sign in to your LMS").closest("[role=dialog]") as HTMLElement;
    fireEvent.click(within(sheet).getByText("Connect"));
    expect(
      await screen.findByText("Sign-in didn't work. Check your student ID and password."),
    ).toBeTruthy();
    expect(useIntegrationStore.getState().integrations[0]).toMatchObject({ connected: false });
  });

  it("says the school is unreachable on a 503", async () => {
    server.use(http.post(`${API}/integrations`, () => HttpResponse.json({}, { status: 503 })));
    renderScreen(<DluAccountsSection />);
    fireEvent.click(screen.getAllByText("Connect")[1]);
    fireEvent.change(await screen.findByPlaceholderText("2112345"), { target: { value: "1" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "x" } });
    const sheet = screen.getByText("Sign in to your student portal").closest("[role=dialog]") as HTMLElement;
    fireEvent.click(within(sheet).getByText("Connect"));
    expect(
      await screen.findByText("Couldn't reach Student portal. Try again in a bit."),
    ).toBeTruthy();
  });
});

describe("DluAccountsSection — connected account", () => {
  const recent = () => new Date(Date.now() - 5 * 60_000).toISOString();

  beforeEach(() => {
    seed(status("LMS", { connected: true, lastSuccessAt: recent() }), status("PORTAL"));
  });

  it("shows when it last synced", () => {
    renderScreen(<DluAccountsSection />);
    expect(screen.getByText("Synced 5 min ago")).toBeTruthy();
    expect(screen.getByLabelText("Sync LMS now")).toBeTruthy();
  });

  it("flags a failing sync with the last good time", () => {
    seed(
      status("LMS", { connected: true, failing: true, lastSyncStatus: "FAILED", lastSuccessAt: recent() }),
      status("PORTAL"),
    );
    renderScreen(<DluAccountsSection />);
    expect(screen.getByText("Sync failing · last synced 5 min ago")).toBeTruthy();
  });

  it("syncs now and confirms", async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/integrations/LMS/sync`, () => {
        calls++;
        return HttpResponse.json({ data: status("LMS", { connected: true, lastSuccessAt: new Date().toISOString() }) });
      }),
    );
    renderScreen(<DluAccountsSection />);
    fireEvent.click(screen.getByLabelText("Sync LMS now"));
    await toastShown("LMS synced");
    expect(calls).toBe(1);
  });

  it.each([
    [429, { "Retry-After": "120" }, "Synced a moment ago", "Try again in 2 min."],
    [409, {}, "Sync in progress", "It will finish soon."],
    [502, {}, "Sync didn't finish", "Check your account details and try again."],
    [503, {}, "Couldn't reach LMS", "Try again in a bit."],
    [500, {}, "Sync failed", "Try again in a moment."],
  ])("explains a %i sync response", async (code, headers, title, description) => {
    server.use(
      http.post(`${API}/integrations/LMS/sync`, () => HttpResponse.json({}, { status: code, headers })),
    );
    renderScreen(<DluAccountsSection />);
    fireEvent.click(screen.getByLabelText("Sync LMS now"));
    await toastShown(title);
    expect(screen.getAllByText(description).length).toBeGreaterThan(0);
  });

  it("disconnects after confirmation", async () => {
    let calls = 0;
    server.use(
      http.delete(`${API}/integrations/LMS`, () => {
        calls++;
        return HttpResponse.json({ data: status("LMS") });
      }),
    );
    renderScreen(<DluAccountsSection />);
    fireEvent.click(screen.getByLabelText("Manage LMS"));
    fireEvent.click(await screen.findByText("Disconnect"));
    fireEvent.click(await screen.findByText("Disconnect LMS?").then((el) => within(el.closest("[role=dialog]") as HTMLElement).getByText("Disconnect")));
    await toastShown("Disconnected");
    expect(calls).toBe(1);
    expect(useIntegrationStore.getState().integrations[0]).toMatchObject({ connected: false });
  });

  it("keeps the account when the user backs out of disconnecting", async () => {
    let calls = 0;
    server.use(http.delete(`${API}/integrations/LMS`, () => ((calls++), HttpResponse.json({ data: status("LMS") }))));
    renderScreen(<DluAccountsSection />);
    fireEvent.click(screen.getByLabelText("Manage LMS"));
    fireEvent.click(await screen.findByText("Disconnect"));
    fireEvent.click(await screen.findByText("Keep it"));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(0);
    expect(useIntegrationStore.getState().integrations[0]).toMatchObject({ connected: true });
  });
});

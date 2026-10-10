import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinishSetupCard } from "@/components/settings/finish-setup-card";
import { ProfileRow } from "@/components/settings/profile-row";
import { TagsRow } from "@/components/settings/tags-row";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

const BASIC_INFO = `${API}/users/update/basic-info`;
const user = { ...testUser, name: "Minh Tran", email: "minh.tran@zenflow.app" } as never;

describe("ProfileRow", () => {
  let patches: Record<string, unknown>[];
  beforeEach(() => {
    patches = [];
    server.use(
      http.patch(BASIC_INFO, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        patches.push(body);
        return HttpResponse.json({ data: { ...testUser, ...body } });
      }),
    );
  });

  it("shows initials, the name and a masked email", () => {
    renderScreen(<ProfileRow user={user} onUpdated={vi.fn()} />);
    expect(screen.getByText("MT")).toBeTruthy();
    expect(screen.getByText("Minh Tran")).toBeTruthy();
    expect(screen.getByText("m••••••••@zenflow.app")).toBeTruthy();
  });

  it("opens the editor with the email locked", async () => {
    renderScreen(<ProfileRow user={user} onUpdated={vi.fn()} />);
    fireEvent.click(screen.getByText("Minh Tran"));
    expect(await screen.findByText("Edit profile")).toBeTruthy();
    expect(screen.getByText("minh.tran@zenflow.app")).toBeTruthy();
    expect(screen.getByText(/so it can't be changed here/)).toBeTruthy();
  });

  it("saves a trimmed new name, reports it and toasts", async () => {
    const onUpdated = vi.fn();
    renderScreen(<ProfileRow user={user} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByText("Minh Tran"));
    fireEvent.change(await screen.findByDisplayValue("Minh Tran"), {
      target: { value: "  Minh T.  " },
    });
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    expect(patches).toEqual([{ name: "Minh T." }]);
    expect(onUpdated.mock.calls[0][0]).toMatchObject({ name: "Minh T." });
    await waitFor(() => expect(screen.getAllByText("Profile updated").length).toBeGreaterThan(0));
  });

  it("closes without calling the API when the name is unchanged", async () => {
    const onUpdated = vi.fn();
    renderScreen(<ProfileRow user={user} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByText("Minh Tran"));
    fireEvent.click(await screen.findByText("Save changes"));
    await waitFor(() => expect(screen.queryByText("Edit profile")).toBeNull());
    expect(patches).toEqual([]);
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("closes without calling the API when the name is blank", async () => {
    renderScreen(<ProfileRow user={user} onUpdated={vi.fn()} />);
    fireEvent.click(screen.getByText("Minh Tran"));
    fireEvent.change(await screen.findByDisplayValue("Minh Tran"), { target: { value: "   " } });
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(screen.queryByText("Edit profile")).toBeNull());
    expect(patches).toEqual([]);
  });

  it("surfaces the server's error message and keeps the sheet open", async () => {
    server.use(
      http.patch(BASIC_INFO, () => HttpResponse.json({ message: "Name is taken" }, { status: 400 })),
    );
    const onUpdated = vi.fn();
    renderScreen(<ProfileRow user={user} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByText("Minh Tran"));
    fireEvent.change(await screen.findByDisplayValue("Minh Tran"), { target: { value: "Other" } });
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(screen.getAllByText("Name is taken").length).toBeGreaterThan(0));
    expect(onUpdated).not.toHaveBeenCalled();
    expect(screen.getByText("Edit profile")).toBeTruthy();
  });
});

describe("FinishSetupCard", () => {
  it("lists the steps still to do and reports a tapped one", () => {
    const onPress = vi.fn();
    renderScreen(
      <FinishSetupCard notificationsActive={false} dluConnected={false} onPress={onPress} />,
    );
    expect(screen.getByText("Finish setting up Zenflow")).toBeTruthy();
    expect(screen.getByText("2 left")).toBeTruthy();
    fireEvent.click(screen.getByText("Connect your LMS or portal"));
    expect(onPress).toHaveBeenCalledWith("dlu");
    fireEvent.click(screen.getByText("Allow notifications"));
    expect(onPress).toHaveBeenCalledWith("notifications");
  });

  it("drops a step once it is done", () => {
    renderScreen(
      <FinishSetupCard notificationsActive dluConnected={false} onPress={vi.fn()} />,
    );
    expect(screen.getByText("1 left")).toBeTruthy();
    expect(screen.queryByText("Allow notifications")).toBeNull();
  });

  it("renders nothing when everything is set up", () => {
    const { container } = renderScreen(
      <FinishSetupCard notificationsActive dluConnected onPress={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("TagsRow", () => {
  let bulk: { names: string[] }[];
  beforeEach(() => {
    bulk = [];
    server.use(
      http.get(`${API}/tags`, () =>
        HttpResponse.json({ data: { tags: [{ id: "1", name: "Study" }, { id: "2", name: "Exam" }] } }),
      ),
      http.post(`${API}/tags/bulk`, async ({ request }) => {
        const body = (await request.json()) as { names: string[] };
        bulk.push(body);
        return HttpResponse.json({ data: { tags: body.names.map((name, i) => ({ id: `n${i}`, name })) } });
      }),
    );
  });

  it("shows how many tags the user has", async () => {
    renderScreen(<TagsRow />);
    await waitFor(() => expect(screen.getByText("2")).toBeTruthy());
  });

  it("posts only the newly ticked tags and updates the count", async () => {
    renderScreen(<TagsRow />);
    await waitFor(() => expect(screen.getByText("2")).toBeTruthy());
    fireEvent.click(screen.getAllByText("Tags")[1]);
    fireEvent.click(await screen.findByText("Lab"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(bulk).toEqual([{ names: ["Lab"] }]));
    await waitFor(() => expect(screen.getByText("3")).toBeTruthy());
  });

  it("makes no request when nothing new is ticked", async () => {
    renderScreen(<TagsRow />);
    await waitFor(() => expect(screen.getByText("2")).toBeTruthy());
    fireEvent.click(screen.getAllByText("Tags")[1]);
    fireEvent.click(await screen.findByText("Save"));
    await new Promise((r) => setTimeout(r, 50));
    expect(bulk).toEqual([]);
  });

  it("toasts when saving tags fails", async () => {
    server.use(http.post(`${API}/tags/bulk`, () => HttpResponse.json({}, { status: 500 })));
    renderScreen(<TagsRow />);
    await waitFor(() => expect(screen.getByText("2")).toBeTruthy());
    fireEvent.click(screen.getAllByText("Tags")[1]);
    fireEvent.click(await screen.findByText("Lab"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getAllByText("Couldn't save tags").length).toBeGreaterThan(0));
  });
});

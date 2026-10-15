import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { useUserStore } from "@/hooks/use-user-store";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";
import LoginScreen from "@/app/(auth)/login";

// Peripheral dropdown (Radix/sheet based) — not under test here.
vi.mock("@/components/language-select", () => ({ LanguageSelect: () => null }));

const byId = (id: string) => screen.getByTestId(id);
const typeEmail = (value: string) =>
  fireEvent.change(byId("login.email"), { target: { value } });
const submit = () => fireEvent.click(byId("login.submit"));

async function reachOtpStage() {
  typeEmail("a@b.co");
  submit();
  await screen.findByText("Enter your code");
}

describe("LoginScreen", () => {
  it("rejects an invalid email without calling the API", async () => {
    // No handler override: an unexpected request would fail via onUnhandledRequest.
    server.use(
      http.post(`${API}/auth/otp/request`, () => {
        throw new Error("must not be called");
      }),
    );
    renderScreen(<LoginScreen />);
    typeEmail("not-an-email");
    submit();
    expect(await screen.findByText("Invalid email address.")).toBeTruthy();
  });

  it("moves to the code stage after the OTP is requested", async () => {
    renderScreen(<LoginScreen />);
    await reachOtpStage();
    expect(screen.getByText("One-Time Password")).toBeTruthy();
  });

  it("shows the server message when requesting a code fails", async () => {
    server.use(
      http.post(`${API}/auth/otp/request`, () =>
        HttpResponse.json({ message: "Mail is down" }, { status: 500 }),
      ),
    );
    renderScreen(<LoginScreen />);
    typeEmail("a@b.co");
    submit();
    expect(await screen.findByText("Mail is down")).toBeTruthy();
  });

  it("locks the email form behind a countdown on 429", async () => {
    server.use(
      http.post(`${API}/auth/otp/request`, () =>
        HttpResponse.json({}, { status: 429, headers: { "Retry-After": "90" } }),
      ),
    );
    renderScreen(<LoginScreen />);
    typeEmail("a@b.co");
    submit();
    expect(
      await screen.findByText("Too many requests. Wait a moment, then try again."),
    ).toBeTruthy();
  });

  it("shows a connectivity message when the network is down", async () => {
    server.use(http.post(`${API}/auth/otp/request`, () => HttpResponse.error()));
    renderScreen(<LoginScreen />);
    typeEmail("a@b.co");
    submit();
    expect(
      await screen.findByText("No connection. Check your internet and try again."),
    ).toBeTruthy();
  });

  it("signs in once a 6-digit code verifies", async () => {
    renderScreen(<LoginScreen />);
    await reachOtpStage();
    fireEvent.change(byId("login.otp"), { target: { value: "123456" } });
    await waitFor(() => expect(useUserStore.getState().user).toEqual(testUser));
  });

  it("shows an error when the code is wrong", async () => {
    server.use(
      http.post(`${API}/auth/otp/verify`, () =>
        HttpResponse.json({ message: "Invalid code" }, { status: 401 }),
      ),
    );
    renderScreen(<LoginScreen />);
    await reachOtpStage();
    fireEvent.change(byId("login.otp"), { target: { value: "000000" } });
    expect(await screen.findByText("Invalid code")).toBeTruthy();
    expect(useUserStore.getState().user).toBeNull();
  });

  it("sends the code to the student address for an ID", async () => {
    let sent: unknown;
    server.use(
      http.post(`${API}/auth/otp/request`, async ({ request }) => {
        sent = ((await request.json()) as { email: string }).email;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderScreen(<LoginScreen />);
    expect(screen.getByText("Student ID")).toBeTruthy();
    expect(byId("login.email-suffix").textContent).toBe("@dlu.edu.vn");
    typeEmail("2012345");
    submit();
    await screen.findByText("Enter your code");
    expect(sent).toBe("2012345@dlu.edu.vn");
  });

  it("asks for an ID when the field is empty", async () => {
    renderScreen(<LoginScreen />);
    submit();
    expect(await screen.findByText("Enter your student ID.")).toBeTruthy();
  });

  it("switches to a full email on @ and sends it as typed", async () => {
    let sent: unknown;
    server.use(
      http.post(`${API}/auth/otp/request`, async ({ request }) => {
        sent = ((await request.json()) as { email: string }).email;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderScreen(<LoginScreen />);
    typeEmail("lan@dlu.edu.vn");
    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.queryByTestId("login.email-suffix")).toBeNull();
    submit();
    await screen.findByText("Enter your code");
    expect(sent).toBe("lan@dlu.edu.vn");
  });

  it("switches modes with the link", async () => {
    renderScreen(<LoginScreen />);
    fireEvent.click(byId("login.use-email"));
    expect(await screen.findByText("Email")).toBeTruthy();
    fireEvent.click(byId("login.use-id"));
    expect(await screen.findByText("Student ID")).toBeTruthy();
  });

  it("keeps a pasted student address as its ID", async () => {
    renderScreen(<LoginScreen />);
    typeEmail("2012345@dlu.edu.vn");
    expect((byId("login.email") as HTMLInputElement).value).toBe("2012345");
    expect(byId("login.email-suffix")).toBeTruthy();
  });

  it("marks the code field for one-time-code autofill", async () => {
    renderScreen(<LoginScreen />);
    await reachOtpStage();
    expect(byId("login.otp").getAttribute("autocomplete")).toBe("one-time-code");
  });

  it("signs in from a pasted message containing the code", async () => {
    renderScreen(<LoginScreen />);
    await reachOtpStage();
    fireEvent.change(byId("login.otp"), {
      target: { value: "Zenflow 2026: your code is 123456" },
    });
    await waitFor(() => expect(useUserStore.getState().user).toEqual(testUser));
  });

  it("returns to the email stage via Change email", async () => {
    renderScreen(<LoginScreen />);
    await reachOtpStage();
    fireEvent.click(byId("login.change-email"));
    expect(await screen.findByText("Login to Zenflow")).toBeTruthy();
  });
});

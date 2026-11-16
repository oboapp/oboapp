import type { User } from "firebase/auth";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationSubscription } from "@/lib/types";
import SettingsPage from "./page";

const mocks = vi.hoisted(() => ({
  auth: {
    user: null as User | null,
    loading: false,
    guestAuthUnavailable: false,
    signOut: vi.fn(),
    reauthenticateWithGoogle: vi.fn(),
    signInWithGoogle: vi.fn(),
  },
  fetchWithAuth: vi.fn(),
  subscribe: vi.fn(),
  router: { push: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/auth-fetch", () => ({ fetchWithAuth: mocks.fetchWithAuth }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/firebase", () => ({ app: {} }));
vi.mock("firebase/messaging", () => ({ getMessaging: vi.fn(), getToken: vi.fn() }));
vi.mock("@/lib/notification-service", () => ({
  subscribeCurrentDeviceForUser: mocks.subscribe,
  getEnableNotificationsMessage: vi.fn(),
  markExplicitUnsubscribe: vi.fn(),
  isMessagingSupported: vi.fn().mockResolvedValue(false),
}));
vi.mock("./NotificationsSection", () => ({
  default: function NotificationsSection({
    subscriptions,
    onSubscribeCurrentDevice,
  }: {
    subscriptions: NotificationSubscription[];
    onSubscribeCurrentDevice: () => void;
  }) {
    return (
      <>
        <output aria-label="Subscriptions">{subscriptions.length}</output>
        <button type="button" onClick={onSubscribeCurrentDevice}>Subscribe</button>
      </>
    );
  },
}));
vi.mock("./LandingViewSection", () => ({ LandingViewSection: () => null }));
vi.mock("./ApiAccessSection", () => ({ default: () => null }));
vi.mock("./DeleteAccountSection", () => ({ default: () => null }));

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((resolveResponse) => {
    resolve = resolveResponse;
  });
  return { promise, resolve };
}

describe("SettingsPage session loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.user = null;
    mocks.auth.loading = false;
    mocks.fetchWithAuth.mockReset();
    mocks.subscribe.mockResolvedValue({ ok: true });
  });

  it("shows session guidance without a user and waits for guest data after sign-in", async () => {
    const response = deferredResponse();
    mocks.fetchWithAuth.mockReturnValue(response.promise);
    const { rerender } = render(<SettingsPage />);
    expect(screen.getByText("Подготвяме сесията")).toBeInTheDocument();
    expect(mocks.fetchWithAuth).not.toHaveBeenCalled();

    mocks.auth.user = { uid: "guest", isAnonymous: true } as User;
    rerender(<SettingsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Зареждане...");
    expect(screen.queryByLabelText("Subscriptions")).not.toBeInTheDocument();
    await act(async () => {
      response.resolve(Response.json([]));
    });

    expect(screen.getByLabelText("Subscriptions")).toHaveTextContent("0");
    expect(mocks.fetchWithAuth).toHaveBeenCalledExactlyOnceWith(
      mocks.auth.user,
      "/api/notifications/subscription/all",
    );
  });

  it("refreshes subscriptions after enabling notifications on this device", async () => {
    mocks.auth.user = { uid: "guest", isAnonymous: true } as User;
    mocks.fetchWithAuth.mockResolvedValueOnce(Response.json([]));
    render(<SettingsPage />);
    await screen.findByRole("button", { name: "Subscribe" });

    const refresh = deferredResponse();
    mocks.fetchWithAuth.mockReturnValueOnce(refresh.promise);
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Зареждане...");
    });
    await act(async () => {
      refresh.resolve(Response.json([{ token: "this-device" }]));
    });

    expect(screen.getByLabelText("Subscriptions")).toHaveTextContent("1");
    expect(mocks.subscribe).toHaveBeenCalledExactlyOnceWith(mocks.auth.user);
    expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(2);
  });

  it("waits for fresh data when the same user's auth state becomes ready again", async () => {
    mocks.auth.user = { uid: "guest", isAnonymous: true } as User;
    mocks.fetchWithAuth.mockResolvedValueOnce(Response.json([{ token: "first-session" }]));
    const { rerender } = render(<SettingsPage />);
    await screen.findByLabelText("Subscriptions");
    expect(screen.getByLabelText("Subscriptions")).toHaveTextContent("1");

    mocks.auth.loading = true;
    rerender(<SettingsPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Зареждане...");
    expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(1);

    const response = deferredResponse();
    mocks.fetchWithAuth.mockReturnValueOnce(response.promise);
    mocks.auth.loading = false;
    rerender(<SettingsPage />);
    expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("Зареждане...");
    expect(screen.queryByLabelText("Subscriptions")).not.toBeInTheDocument();
    await act(async () => {
      response.resolve(Response.json([]));
    });

    expect(screen.getByLabelText("Subscriptions")).toHaveTextContent("0");
  });

  it("waits for subscriptions and API access when the same guest account is linked", async () => {
    const user = { uid: "linked-user", isAnonymous: true } as User;
    mocks.auth.user = user;
    mocks.fetchWithAuth.mockResolvedValueOnce(Response.json([]));
    const { rerender } = render(<SettingsPage />);
    await screen.findByLabelText("Subscriptions");

    const subscriptions = deferredResponse();
    const apiClient = deferredResponse();
    mocks.fetchWithAuth
      .mockReturnValueOnce(subscriptions.promise)
      .mockReturnValueOnce(apiClient.promise);
    Object.assign(user, { isAnonymous: false });
    rerender(<SettingsPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Зареждане...");
    expect(screen.queryByLabelText("Subscriptions")).not.toBeInTheDocument();
    expect(mocks.fetchWithAuth).toHaveBeenNthCalledWith(
      2,
      user,
      "/api/notifications/subscription/all",
    );
    await act(async () => {
      subscriptions.resolve(Response.json([{ token: "linked-device" }]));
    });
    expect(mocks.fetchWithAuth).toHaveBeenNthCalledWith(3, user, "/api/api-clients");
    expect(screen.getByRole("status")).toHaveTextContent("Зареждане...");
    await act(async () => {
      apiClient.resolve(Response.json(null));
    });

    expect(screen.getByLabelText("Subscriptions")).toHaveTextContent("1");
    expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(3);
  });
});

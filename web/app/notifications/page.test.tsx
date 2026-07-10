import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import NotificationsPage from "@/app/notifications/page";
import type { NotificationHistoryItem } from "@/lib/types";

const mockUseAuth = vi.hoisted(() => vi.fn());
const mockUseRouter = vi.hoisted(() => vi.fn());
const mockUseSubscriptionStatus = vi.hoisted(() => vi.fn());
const mockUseNotificationHistory = vi.hoisted(() => vi.fn());
const mockSubscribeCurrentDeviceForUser = vi.hoisted(() => vi.fn());
const mockGetEnableNotificationsMessage = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
const mockCaptureException = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-context", () => ({
  useAuth: mockUseAuth,
}));

vi.mock("next/navigation", () => ({
  useRouter: mockUseRouter,
}));

vi.mock("@/lib/hooks/useSubscriptionStatus", () => ({
  useSubscriptionStatus: mockUseSubscriptionStatus,
}));

vi.mock("@/lib/hooks/useNotificationHistory", () => ({
  useNotificationHistory: mockUseNotificationHistory,
}));

vi.mock("@/lib/notification-service", () => ({
  subscribeCurrentDeviceForUser: mockSubscribeCurrentDeviceForUser,
  getEnableNotificationsMessage: mockGetEnableNotificationsMessage,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mockCaptureException,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    onClick,
    className,
    children,
  }: {
    href: string;
    onClick?: () => void;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/SourceLogo", () => ({
  default: ({ sourceId }: { sourceId: string }) => (
    <div data-testid={`source-logo-${sourceId}`} />
  ),
}));

vi.mock("@/lib/sources", () => ({
  default: [{ id: "municipality-sofia", name: "Столична община" }],
}));

vi.mock("@/components/BackButton", () => ({
  default: () => <button type="button">Назад</button>,
}));

vi.mock("@/components/LoadingSpinner", () => ({
  default: () => <div data-testid="loading-spinner" />,
}));

vi.mock("@/app/settings/SubscribeDevicePrompt", () => ({
  default: ({ onSubscribe }: { onSubscribe: () => void }) => (
    <button type="button" onClick={onSubscribe}>
      Абонирай устройството
    </button>
  ),
}));

const baseNotification: NotificationHistoryItem = {
  id: "notification-1",
  messageId: "message-1",
  messageSnapshot: {
    text: "Тестово известие",
    createdAt: "2026-07-10T09:00:00.000Z",
    source: "municipality-sofia",
    sourceUrl: "https://www.sofia.bg",
  },
  notifiedAt: "2026-07-10T10:00:00.000Z",
  interestId: "interest-1",
  successfulDevicesCount: 1,
  distance: 25,
  readAt: undefined,
};

describe("NotificationsPage", () => {
  const push = vi.fn();
  const checkStatus = vi.fn();
  const markAsRead = vi.fn();
  const markAllRead = vi.fn();
  const loadMore = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseRouter.mockReturnValue({ push });

    mockUseAuth.mockReturnValue({
      user: { uid: "user-1", isAnonymous: false },
      loading: false,
    });

    mockUseSubscriptionStatus.mockReturnValue({
      isCurrentDeviceSubscribed: true,
      hasAnySubscriptions: true,
      checkStatus,
    });

    mockUseNotificationHistory.mockReturnValue({
      notifications: [baseNotification],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore,
      markAsRead,
      markAllRead,
    });

    mockGetEnableNotificationsMessage.mockReturnValue("Активирай известия");
  });

  it("renders source logo and resolved source name in notification row", () => {
    render(<NotificationsPage />);

    expect(
      screen.getByTestId("source-logo-municipality-sofia"),
    ).toBeInTheDocument();
    expect(screen.getByText("Столична община")).toBeInTheDocument();
  });

  it("redirects to home only after auth loading is complete and user is missing", async () => {
    mockUseAuth.mockReturnValueOnce({ user: null, loading: true });

    const { rerender } = render(<NotificationsPage />);
    expect(push).not.toHaveBeenCalled();

    mockUseAuth.mockReturnValue({ user: null, loading: false });
    rerender(<NotificationsPage />);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/");
    });
  });

  it("captures exception and shows toast when subscribe action fails", async () => {
    mockUseSubscriptionStatus.mockReturnValue({
      isCurrentDeviceSubscribed: false,
      hasAnySubscriptions: false,
      checkStatus,
    });

    const subscribeError = new Error("subscribe failed");
    mockSubscribeCurrentDeviceForUser.mockRejectedValue(subscribeError);

    render(<NotificationsPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Абонирай устройството" }),
    );

    await waitFor(() => {
      expect(mockCaptureException).toHaveBeenCalledWith(subscribeError, {
        level: "warning",
        tags: {
          area: "notifications",
          action: "subscribeCurrentDevice",
        },
      });
      expect(mockToastError).toHaveBeenCalledWith("Грешка при абонирането");
      expect(checkStatus).toHaveBeenCalledTimes(1);
    });
  });
});

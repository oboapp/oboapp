import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationItem from "@/components/NotificationItem";
import type { NotificationHistoryItem } from "@/lib/types";

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

const baseNotification: NotificationHistoryItem = {
  id: "notification-1",
  messageId: "message-1",
  messageSnapshot: {
    text: "Тестово известие за ВиК авария",
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

describe("NotificationItem", () => {
  const onMarkAsRead = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the message preview text", () => {
    render(
      <NotificationItem
        notification={baseNotification}
        onMarkAsRead={onMarkAsRead}
      />,
    );

    expect(
      screen.getByText("Тестово известие за ВиК авария"),
    ).toBeInTheDocument();
  });

  it("renders source logo and resolved source name when sourceId is present", () => {
    render(
      <NotificationItem
        notification={baseNotification}
        onMarkAsRead={onMarkAsRead}
      />,
    );

    expect(
      screen.getByTestId("source-logo-municipality-sofia"),
    ).toBeInTheDocument();
    expect(screen.getByText("Столична община")).toBeInTheDocument();
  });

  it("does not render source logo when sourceId is absent", () => {
    const notification: NotificationHistoryItem = {
      ...baseNotification,
      messageSnapshot: {
        ...baseNotification.messageSnapshot,
        source: undefined,
      },
    };

    render(
      <NotificationItem
        notification={notification}
        onMarkAsRead={onMarkAsRead}
      />,
    );

    expect(screen.queryByTestId(/source-logo/)).not.toBeInTheDocument();
  });

  it("renders unread indicator dot when notification is unread", () => {
    const { container } = render(
      <NotificationItem
        notification={baseNotification}
        onMarkAsRead={onMarkAsRead}
      />,
    );

    expect(
      container.querySelector(".bg-primary.rounded-full"),
    ).toBeInTheDocument();
  });

  it("does not render unread indicator dot when notification is read", () => {
    const read: NotificationHistoryItem = {
      ...baseNotification,
      readAt: "2026-07-10T11:00:00.000Z",
    };

    const { container } = render(
      <NotificationItem notification={read} onMarkAsRead={onMarkAsRead} />,
    );

    expect(
      container.querySelector(".bg-primary.rounded-full"),
    ).not.toBeInTheDocument();
  });

  it("applies unread highlight class when notification is unread", () => {
    const { container } = render(
      <NotificationItem
        notification={baseNotification}
        onMarkAsRead={onMarkAsRead}
      />,
    );

    expect(container.querySelector("a")?.className).toContain("!bg-info-light");
  });

  it("does not apply unread highlight class when notification is read", () => {
    const read: NotificationHistoryItem = {
      ...baseNotification,
      readAt: "2026-07-10T11:00:00.000Z",
    };

    const { container } = render(
      <NotificationItem notification={read} onMarkAsRead={onMarkAsRead} />,
    );

    expect(container.querySelector("a")?.className).not.toContain(
      "!bg-info-light",
    );
  });

  it("calls onMarkAsRead with notification id when clicked and unread", async () => {
    render(
      <NotificationItem
        notification={baseNotification}
        onMarkAsRead={onMarkAsRead}
      />,
    );

    await userEvent.click(screen.getByRole("link"));

    expect(onMarkAsRead).toHaveBeenCalledWith("notification-1");
  });

  it("does not call onMarkAsRead when clicked and already read", async () => {
    const read: NotificationHistoryItem = {
      ...baseNotification,
      readAt: "2026-07-10T11:00:00.000Z",
    };

    render(
      <NotificationItem notification={read} onMarkAsRead={onMarkAsRead} />,
    );

    await userEvent.click(screen.getByRole("link"));

    expect(onMarkAsRead).not.toHaveBeenCalled();
  });

  it("calls onClose when provided and link is clicked", async () => {
    render(
      <NotificationItem
        notification={baseNotification}
        onMarkAsRead={onMarkAsRead}
        onClose={onClose}
      />,
    );

    await userEvent.click(screen.getByRole("link"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not throw when onClose is not provided and link is clicked", async () => {
    render(
      <NotificationItem
        notification={baseNotification}
        onMarkAsRead={onMarkAsRead}
      />,
    );

    await expect(
      userEvent.click(screen.getByRole("link")),
    ).resolves.not.toThrow();
  });

  it("calls both onMarkAsRead and onClose when unread and onClose is provided", async () => {
    render(
      <NotificationItem
        notification={baseNotification}
        onMarkAsRead={onMarkAsRead}
        onClose={onClose}
      />,
    );

    await userEvent.click(screen.getByRole("link"));

    expect(onMarkAsRead).toHaveBeenCalledWith("notification-1");
    expect(onClose).toHaveBeenCalledOnce();
  });
});

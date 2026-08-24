// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationList } from "./notification-list";
import type { NotificationItem } from "@/lib/newinmeter/alerts";

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "event-1",
    type: "low_balance",
    title: "Low balance",
    body: "Your balance is R143.50, below your R170.00 alert.",
    url: "/",
    triggeredAt: new Date().toISOString(),
    readAt: null,
    isRead: false,
    ...overrides
  };
}

describe("NotificationList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the empty state when there are no notifications", () => {
    render(
      <NotificationList
        loading={false}
        markingAllRead={false}
        notifications={[]}
        onItemClick={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );

    expect(screen.queryByText("You're all caught up.")).not.toBeNull();
    expect(screen.queryByText("Mark all as read")).toBeNull();
  });

  it("only shows 'Mark all as read' when something is unread", () => {
    const { rerender } = render(
      <NotificationList
        loading={false}
        markingAllRead={false}
        notifications={[item({ isRead: true })]}
        onItemClick={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );
    expect(screen.queryByText("Mark all as read")).toBeNull();

    rerender(
      <NotificationList
        loading={false}
        markingAllRead={false}
        notifications={[item({ isRead: false })]}
        onItemClick={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );
    expect(screen.queryByText("Mark all as read")).not.toBeNull();
  });

  it("marks unread rows for assistive tech and calls onItemClick when a row is activated", () => {
    const onItemClick = vi.fn();
    const unread = item({ id: "unread-event", isRead: false });
    render(
      <NotificationList
        loading={false}
        markingAllRead={false}
        notifications={[unread]}
        onItemClick={onItemClick}
        onMarkAllRead={vi.fn()}
      />
    );

    expect(screen.queryByText("(unread)")).not.toBeNull();

    fireEvent.click(screen.getByText("Low balance"));
    expect(onItemClick).toHaveBeenCalledWith(unread);
    expect(onItemClick).toHaveBeenCalledTimes(1);
  });

  it("does not mark a click just from appearing on screen -- only an actual click fires onItemClick", () => {
    const onItemClick = vi.fn();
    render(
      <NotificationList
        loading={false}
        markingAllRead={false}
        notifications={[item()]}
        onItemClick={onItemClick}
        onMarkAllRead={vi.fn()}
      />
    );
    expect(onItemClick).not.toHaveBeenCalled();
  });

  it("calls onMarkAllRead when the control is clicked", () => {
    const onMarkAllRead = vi.fn();
    render(
      <NotificationList
        loading={false}
        markingAllRead={false}
        notifications={[item()]}
        onItemClick={vi.fn()}
        onMarkAllRead={onMarkAllRead}
      />
    );

    fireEvent.click(screen.getByText("Mark all as read"));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it("suppresses its own header when showHeader is false", () => {
    render(
      <NotificationList
        loading={false}
        markingAllRead={false}
        notifications={[]}
        onItemClick={vi.fn()}
        onMarkAllRead={vi.fn()}
        showHeader={false}
      />
    );
    expect(screen.queryByRole("heading", { name: "Notifications" })).toBeNull();
  });

  it("shows a loading state", () => {
    render(
      <NotificationList
        loading
        markingAllRead={false}
        notifications={[]}
        onItemClick={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );
    expect(screen.queryByText("Loading…")).not.toBeNull();
  });
});

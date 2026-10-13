// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AdminUserListItem } from "@/lib/user-roles";
const sort = vi.hoisted(() => ({ key: "lastSync" as "lastSync" | "joined", direction: "desc" as "asc" | "desc" }));
vi.mock("@/lib/url-state/use-admin-users-url-state", () => ({
  useAdminUsersUrlState: () => ({
    sortKey: sort.key,
    sortDirection: sort.direction,
    onSortChange: vi.fn(),
    onSortKeyChange: vi.fn(),
    onSortDirectionChange: vi.fn()
  })
}));
vi.mock("./manage-drawer", () => ({ ManageDrawer: () => null }));
import { AdminUsersTable } from "./admin-users-table";
const disabled = { enabled: false, source: "rollout" as const };
const user: AdminUserListItem = {
  lastActiveAt: null,
  inactivitySource: null,
  userId: "user",
  email: "old@example.test",
  createdAt: "2026-01-01T00:00:00Z",
  role: "user",
  features: { ai: disabled, activities: disabled, alerts: disabled, live: disabled },
  connectionStatus: "connected",
  connectionLifecycle: "active",
  lastRunStatus: "success",
  lastRunAt: "2026-10-13T12:00:00Z",
  lastRunError: null,
  lastRunRowsSynced: 1,
  autoSyncEnabled: true,
  nextSyncAt: null,
  lastAutoSyncStatus: "success",
  lastAutoSyncAt: null
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("does not immediately refetch SSR data and keeps rows visible during manual refresh", async () => {
  let complete!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      })
  );
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AdminUsersTable currentUserId="admin" initialData={{ rows: [user], total: 1 }} />
    </QueryClientProvider>
  );
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Refresh users" })[0]);
  expect(screen.getAllByText("old@example.test")).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Refresh users" })[0].hasAttribute("disabled")).toBe(true);
  complete(new Response(JSON.stringify({ rows: [{ ...user, email: "new@example.test" }], total: 1 }), { status: 200 }));
  await waitFor(() => expect(screen.getAllByText("new@example.test")).toHaveLength(2));
  expect(screen.queryByText("old@example.test")).toBeNull();
  client.clear();
});

beforeEach(() => {
  sort.key = "lastSync";
  sort.direction = "desc";
});
it.each([
  ["joined", "asc"],
  ["joined", "desc"],
  ["lastSync", "asc"],
  ["lastSync", "desc"]
] as const)("pins the current user before %s %s while preserving the remaining order", (key, direction) => {
  sort.key = key;
  sort.direction = direction;
  const rows = [
    {
      ...user,
      userId: "older",
      email: "older@example.test",
      createdAt: "2026-01-01T00:00:00Z",
      lastRunAt: "2026-01-01T00:00:00Z"
    },
    {
      ...user,
      userId: "newer",
      email: "newer@example.test",
      createdAt: "2026-10-01T00:00:00Z",
      lastRunAt: "2026-10-01T00:00:00Z"
    },
    { ...user, userId: "self", email: "self@example.test", createdAt: "2026-06-01T00:00:00Z", lastRunAt: null }
  ];
  const client = new QueryClient();
  const { container } = render(
    <QueryClientProvider client={client}>
      <AdminUsersTable currentUserId="self" initialData={{ rows, total: rows.length }} />
    </QueryClientProvider>
  );
  const tableRows = Array.from(container.querySelectorAll("tbody tr"));
  expect(tableRows[0].textContent).toContain("self@example.test");
  expect(tableRows[1].textContent).toContain(direction === "asc" ? "older@example.test" : "newer@example.test");
  expect(container.querySelector(".sm\\:hidden .divide-y")?.textContent?.indexOf("self@example.test")).toBe(0);
  client.clear();
});

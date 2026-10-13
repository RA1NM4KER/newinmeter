// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { AdminUserListItem } from "@/lib/user-roles";
vi.mock("@/lib/url-state/use-admin-users-url-state", () => ({
  useAdminUsersUrlState: () => ({
    sortKey: "lastSync",
    sortDirection: "desc",
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

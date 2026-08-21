"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_USERS_DEFAULT_DIRECTION,
  ADMIN_USERS_DEFAULT_SORT,
  adminUsersQueryParamKeys,
  defaultDirectionFor,
  parseAdminUsersQuery,
  type AdminUsersSortKey
} from "@/lib/admin-users-query-params";
import { applyQueryUpdates, queryHref } from "@/lib/url-query";

export type AdminUsersUrlState = {
  sortKey: AdminUsersSortKey;
  sortDirection: "asc" | "desc";
  isPending: boolean;
  onSortChange: (key: AdminUsersSortKey) => void;
};

export function useAdminUsersUrlState(): AdminUsersUrlState {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const state = useMemo(() => parseAdminUsersQuery(new URLSearchParams(searchParams.toString())), [searchParams]);

  // Clicking the active column flips its direction; clicking a different column
  // switches to it at that column's default direction. The schema defaults
  // (last sync / desc) are omitted from the URL to keep it clean.
  const onSortChange = (key: AdminUsersSortKey) => {
    const nextDirection =
      key === state.sortKey ? (state.sortDirection === "asc" ? "desc" : "asc") : defaultDirectionFor(key);

    const next = applyQueryUpdates(searchParams, {
      [adminUsersQueryParamKeys.sort]: key === ADMIN_USERS_DEFAULT_SORT ? null : key,
      [adminUsersQueryParamKeys.direction]: nextDirection === ADMIN_USERS_DEFAULT_DIRECTION ? null : nextDirection
    });

    startTransition(() => {
      router.replace(queryHref(pathname, next), { scroll: false });
    });
  };

  return {
    sortKey: state.sortKey,
    sortDirection: state.sortDirection,
    isPending,
    onSortChange
  };
}

import { z } from "zod";
import type { SortDirection, SortKey } from "@/components/data/types";
import { filterQueryParamKeys, parseDateRangeQuery } from "@/lib/filter-query-params";
import type { EnergyRow } from "@/lib/types";

export type ChargeTypeFilter = "all" | EnergyRow["chargeKind"];

export const dataTableQueryParamKeys = {
  ...filterQueryParamKeys,
  chargeType: "chargeType",
  search: "search",
  page: "page",
  pageSize: "pageSize",
  sort: "sort",
  direction: "dir"
} as const;

export const sortKeyOptions = ["period", "type", "band", "kwh", "tariff", "amount", "balance", "captured"] as const;
export const pageSizeOptions = [25, 50, 100] as const;

const chargeTypeSchema = z.enum(["all", "energy", "water", "fixed", "topup", "refund"]);
const sortKeySchema = z.enum(sortKeyOptions);
const sortDirectionSchema = z.enum(["asc", "desc"]);

const dataTableQuerySchema = z.object({
  chargeType: chargeTypeSchema.catch("all"),
  search: z
    .string()
    .optional()
    .transform((value) => value?.trim() ?? ""),
  sort: sortKeySchema.catch("captured"),
  dir: sortDirectionSchema.catch("desc"),
  page: z.coerce.number().int().positive().catch(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => pageSizeOptions.includes(value as (typeof pageSizeOptions)[number]))
    .catch(50)
});

export type DataTableQueryParams = {
  from: string;
  to: string;
  chargeType: ChargeTypeFilter;
  search: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
};

export function parseDataTableQuery(searchParams: URLSearchParams): DataTableQueryParams {
  const dateRange = parseDateRangeQuery(searchParams);
  const parsed = dataTableQuerySchema.parse({
    chargeType: searchParams.get(dataTableQueryParamKeys.chargeType) ?? undefined,
    search: searchParams.get(dataTableQueryParamKeys.search) ?? undefined,
    sort: searchParams.get(dataTableQueryParamKeys.sort) ?? undefined,
    dir: searchParams.get(dataTableQueryParamKeys.direction) ?? undefined,
    page: searchParams.get(dataTableQueryParamKeys.page) ?? undefined,
    pageSize: searchParams.get(dataTableQueryParamKeys.pageSize) ?? undefined
  });

  return {
    from: dateRange.from,
    to: dateRange.to,
    chargeType: parsed.chargeType,
    search: parsed.search,
    sortKey: parsed.sort,
    sortDirection: parsed.dir,
    page: parsed.page,
    pageSize: parsed.pageSize
  };
}

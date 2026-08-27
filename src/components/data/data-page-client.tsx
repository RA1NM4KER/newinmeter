"use client";

import { DataTable } from "@/components/data/data-table";

export function DataPageClient({ isDemo = false }: { isDemo?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DataTable isDemo={isDemo} />
    </div>
  );
}

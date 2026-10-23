"use client";

import type { PaginationState } from "@tanstack/react-table";
import { History } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/layout/app-context";
import { columnHelper, DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DateTime } from "@/components/shared/date-time";
import { EmptyState } from "@/components/shared/empty-state";
import { ALL, FilterBar, FilterSelect } from "@/components/shared/filter-bar";
import { TableSkeleton } from "@/components/shared/skeletons";
import { Pill } from "@/components/shared/status-badge";
import { useAsync } from "@/hooks/use-async";
import { getAuditLog } from "@/lib/api";
import type { AuditEntry } from "@/lib/types";
import { SettingsCard } from "./settings-card";

const ACTIONS = [
  { value: ALL, label: "All actions" },
  { value: "client.", label: "Clients" },
  { value: "transaction.", label: "Transactions" },
  { value: "ib.", label: "IBs" },
  { value: "month.", label: "Finalize / reopen" },
  { value: "payout.", label: "Payouts" },
  { value: "settings.", label: "Settings" },
  { value: "user.", label: "Users" },
];

const helper = columnHelper<AuditEntry>();
const columns: DataTableColumn<AuditEntry>[] = [
  helper.accessor("at", {
    header: "When",
    enableSorting: false,
    cell: (info) => <DateTime value={info.getValue()} className="text-xs" />,
  }),
  helper.accessor("userEmail", {
    header: "Who",
    enableSorting: false,
    cell: (info) => <span className="text-xs font-medium">{info.getValue()}</span>,
  }),
  helper.accessor("action", {
    header: "Action",
    enableSorting: false,
    cell: (info) => (
      <Pill tone={info.getValue().startsWith("month.") ? "gold" : info.getValue().endsWith("delete") ? "red" : "grey"} className="num text-[11px]">
        {info.getValue()}
      </Pill>
    ),
  }),
  helper.accessor("summary", {
    header: "What",
    enableSorting: false,
    meta: { className: "whitespace-normal min-w-80" },
    cell: (info) => <span className="text-sm">{info.getValue()}</span>,
  }),
];

export function AuditPanel() {
  const { dataVersion } = useApp();
  const [action, setAction] = useState(ALL);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const { data, loading } = useAsync(
    () => getAuditLog({ action: action === ALL ? undefined : action, page: pagination.pageIndex, pageSize: pagination.pageSize }),
    [action, pagination.pageIndex, pagination.pageSize, dataVersion],
    { keepPreviousData: true },
  );

  return (
    <SettingsCard wide title="Audit log" description="Who did what, and when. Entries can't be edited or deleted.">
      <FilterBar>
        <FilterSelect
          label="Filter by action"
          value={action}
          onChange={(v) => {
            setAction(v);
            setPagination((p) => ({ ...p, pageIndex: 0 }));
          }}
          options={ACTIONS}
        />
      </FilterBar>
      {data ? (
        <DataTable
          columns={columns}
          data={data.rows}
          getRowId={(e) => String(e.id)}
          server={{
            rowCount: data.total,
            pagination,
            onPaginationChange: setPagination,
            sorting: [],
            onSortingChange: () => undefined,
            loading,
          }}
          empty={<EmptyState icon={History} title="Nothing logged yet" description="Changes to clients, money, months and settings appear here." />}
        />
      ) : (
        <TableSkeleton rows={8} columns={4} />
      )}
    </SettingsCard>
  );
}

"use client";

import type { PaginationState, SortingState } from "@tanstack/react-table";
import { Download, Loader2, Plus, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/layout/app-context";
import { columnHelper, DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ALL, FilterBar, FilterSelect, SearchInput } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { PersonCell } from "@/components/shared/person-cell";
import { ProfitText } from "@/components/shared/profit-text";
import { TableSkeleton } from "@/components/shared/skeletons";
import { SyncDot } from "@/components/shared/account-status";
import { Pill, StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
import { exportClients, getClients, getIBs } from "@/lib/api";
import { formatCurrency, formatLots, signOf } from "@/lib/calculations";
import { formatMonth } from "@/lib/dates";
import type { ClientAccountBrief, ClientQuery, ClientSortKey, ClientStatus, ClientSummary, MonthKey } from "@/lib/types";

const helper = columnHelper<ClientSummary>();

const nullableMoney = (value: string | null) =>
  value === null ? <span className="text-xs text-muted-foreground">—</span> : <span className="num">{formatCurrency(value)}</span>;

function buildColumns(month: MonthKey): DataTableColumn<ClientSummary>[] {
  return [
    helper.accessor("fullName", {
      header: "Name",
      cell: (info) => (
        <PersonCell name={info.getValue()} code={info.row.original.code} muted={info.row.original.status === "inactive"} />
      ),
    }),
    helper.accessor("ibName", {
      header: "Source",
      cell: (info) =>
        info.row.original.ibId ? <span className="font-medium">{info.getValue()}</span> : <Pill tone="gold">Direct</Pill>,
    }),
    helper.accessor("accounts", {
      header: "MT5 account(s)",
      enableSorting: false,
      cell: (info) => {
        const accounts = info.getValue();
        if (!accounts.length) return <span className="text-xs text-muted-foreground">Pool only</span>;
        return (
          <div className="flex items-center gap-1.5">
            <SyncDot
              health={info.row.original.syncHealth}
              label={accounts.some((a: ClientAccountBrief) => a.syncState === "error") ? "A sync is failing — open the client" : undefined}
            />
            <span className="num text-xs">
              {accounts[0].login}
              {accounts.length > 1 ? ` +${accounts.length - 1}` : ""}
            </span>
          </div>
        );
      },
    }),
    helper.accessor("investedCapital", {
      header: "Capital",
      meta: { align: "right" },
      cell: (info) => <span className="num font-semibold">{formatCurrency(info.getValue())}</span>,
    }),
    helper.accessor("balance", { header: "Balance", enableSorting: false, meta: { align: "right" }, cell: (info) => nullableMoney(info.getValue()) }),
    helper.accessor("equity", { header: "Equity", enableSorting: false, meta: { align: "right" }, cell: (info) => nullableMoney(info.getValue()) }),
    helper.accessor("floatingPl", {
      header: "Floating P/L",
      enableSorting: false,
      meta: { align: "right" },
      cell: (info) => (info.getValue() === null ? <span className="text-xs text-muted-foreground">—</span> : <ProfitText value={info.getValue()!} />),
    }),
    helper.accessor("monthNetProfit", {
      header: `${formatMonth(month, { short: true })} profit`,
      meta: { align: "right" },
      cell: (info) => (
        <div className="leading-tight">
          <ProfitText value={info.getValue()} />
          <p className="num text-[11px] text-muted-foreground">{formatLots(info.row.original.monthLots)} lots</p>
        </div>
      ),
    }),
    helper.accessor("carriedLoss", {
      header: "Loss to recover",
      meta: { align: "right" },
      cell: (info) =>
        signOf(info.getValue()) < 0 ? (
          <span className="num text-loss">{formatCurrency(info.getValue().replace("-", ""))}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    }),
    helper.accessor("status", {
      header: "Status",
      enableSorting: false,
      cell: (info) => <StatusBadge status={info.getValue()} />,
    }),
  ];
}

const FIRST_PAGE: PaginationState = { pageIndex: 0, pageSize: 10 };

export function ClientsView() {
  const router = useRouter();
  const { month, dataVersion, openAddClient, canEdit } = useApp();
  const [search, setSearch] = useState("");
  const [ibId, setIbId] = useState(useSearchParams().get("source") ?? ALL);
  const [status, setStatus] = useState(ALL);
  const [pagination, setPagination] = useState<PaginationState>(FIRST_PAGE);
  const [sorting, setSorting] = useState<SortingState>([{ id: "investedCapital", desc: true }]);
  const [exporting, setExporting] = useState(false);
  const debouncedSearch = useDebounced(search.trim());

  const query: ClientQuery = {
    month: month ?? undefined,
    search: debouncedSearch || undefined,
    ibId: ibId === ALL ? undefined : ibId,
    status: status === ALL ? undefined : (status as ClientStatus),
    sort: sorting[0]?.id as ClientSortKey | undefined,
    dir: sorting[0]?.desc ? "desc" : "asc",
  };

  const { data: ibs } = useAsync(() => getIBs(), [dataVersion]);
  const { data: page, loading } = useAsync(
    () => getClients({ ...query, page: pagination.pageIndex, pageSize: pagination.pageSize }),
    [query.month, query.search, query.ibId, query.status, query.sort, query.dir, pagination.pageIndex, pagination.pageSize, dataVersion],
    { enabled: month !== null, keepPreviousData: true },
  );

  const filtersActive = Boolean(query.search || query.ibId || query.status);
  const resetPage = () => setPagination(FIRST_PAGE);

  async function onExport() {
    setExporting(true);
    try {
      await exportClients(query);
      toast.success("Excel file downloaded");
    } catch (err) {
      toast.error("Couldn't export clients", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description={
          page
            ? `${page.total} ${filtersActive ? "matching " : ""}client${page.total === 1 ? "" : "s"} · ${formatCurrency(page.totalCapital)} capital`
            : "Investors, their MT5 accounts and the profit their accounts make."
        }
        actions={
          <>
            <Button variant="outline" disabled={!page?.total || exporting} onClick={onExport}>
              {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />} Export Excel
            </Button>
            {canEdit ? (
              <Button onClick={openAddClient} className="font-semibold">
                <Plus aria-hidden /> Add Client
              </Button>
            ) : null}
          </>
        }
      />

      <Card className="gap-0 py-0">
        <FilterBar>
          <SearchInput
            id="client-search"
            label="Search clients"
            value={search}
            onChange={(v) => {
              setSearch(v);
              resetPage();
            }}
            placeholder="Search name, ID, phone or email"
          />
          <div className="flex gap-3 md:ml-auto">
            <FilterSelect
              label="Filter by source"
              value={ibId}
              onChange={(v) => {
                setIbId(v);
                resetPage();
              }}
              options={[
                { value: ALL, label: "All sources" },
                { value: "direct", label: "Direct" },
                ...(ibs ?? []).map((ib) => ({ value: ib.id, label: ib.name })),
              ]}
            />
            <FilterSelect
              label="Filter by status"
              value={status}
              onChange={(v) => {
                setStatus(v);
                resetPage();
              }}
              className="md:w-36"
              options={[
                { value: ALL, label: "All statuses" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
            />
          </div>
        </FilterBar>

        {page && month ? (
          <DataTable
            columns={buildColumns(month)}
            data={page.rows}
            getRowId={(c) => c.id}
            server={{
              rowCount: page.total,
              pagination,
              onPaginationChange: setPagination,
              sorting,
              onSortingChange: setSorting,
              loading,
            }}
            onRowClick={(c) => router.push(`/clients/${c.id}`)}
            rowLabel={(c) => `Open ${c.fullName}`}
            empty={
              filtersActive ? (
                <EmptyState icon={Users} title="No clients match" description="Try a different search or clear the filters." />
              ) : (
                <EmptyState
                  icon={Users}
                  title="No clients yet"
                  description="Add a client with their EC Markets MT5 login and investor password."
                  action={
                    canEdit ? (
                      <Button onClick={openAddClient}>
                        <Plus aria-hidden /> Add Client
                      </Button>
                    ) : undefined
                  }
                />
              )
            }
          />
        ) : (
          <TableSkeleton rows={8} columns={9} />
        )}
      </Card>
    </div>
  );
}

"use client";

import type { PaginationState, SortingState } from "@tanstack/react-table";
import { Download, Loader2, Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
import { exportClients, getClients, getIBs } from "@/lib/api";
import { formatCurrency, signOf } from "@/lib/calculations";
import { formatDate, formatMonth } from "@/lib/dates";
import type { ClientQuery, ClientSortKey, ClientStatus, ClientSummary, MonthKey } from "@/lib/types";

const helper = columnHelper<ClientSummary>();

function buildColumns(month: MonthKey): DataTableColumn<ClientSummary>[] {
  return [
    helper.accessor("fullName", {
      header: "Name",
      cell: (info) => (
        <PersonCell name={info.getValue()} code={info.row.original.code} muted={info.row.original.status === "inactive"} />
      ),
    }),
    helper.accessor("phone", {
      header: "Phone",
      enableSorting: false,
      cell: (info) => <span className="num text-xs text-muted-foreground">{info.getValue()}</span>,
    }),
    helper.accessor("ibName", { header: "IB", cell: (info) => <span className="font-medium">{info.getValue()}</span> }),
    helper.accessor("investedCapital", {
      header: "Invested capital",
      meta: { align: "right" },
      cell: (info) => <span className="num font-semibold">{formatCurrency(info.getValue())}</span>,
    }),
    helper.accessor("joinedAt", {
      header: "Join date",
      cell: (info) => <span className="num text-xs">{formatDate(info.getValue())}</span>,
    }),
    helper.accessor("monthProfit", {
      header: `${formatMonth(month, { short: true })} result`,
      meta: { align: "right" },
      cell: (info) => <ProfitText value={info.getValue()} />,
    }),
    helper.accessor("totalProfit", {
      header: "Total result",
      meta: { align: "right" },
      cell: (info) => (
        <div className="leading-tight">
          <ProfitText value={info.getValue()} />
          {signOf(info.row.original.carriedLoss) < 0 ? (
            <p className="num text-[11px] text-loss">carrying {formatCurrency(info.row.original.carriedLoss)}</p>
          ) : null}
        </div>
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
  const [ibId, setIbId] = useState(ALL);
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
            ? `${page.total} ${filtersActive ? "matching " : ""}client${page.total === 1 ? "" : "s"} · ${formatCurrency(page.totalCapital)} invested`
            : "Investors in the pool and the profit they've earned."
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
              label="Filter by IB"
              value={ibId}
              onChange={(v) => {
                setIbId(v);
                resetPage();
              }}
              options={[{ value: ALL, label: "All IBs" }, ...(ibs ?? []).map((ib) => ({ value: ib.id, label: ib.name }))]}
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
                  description="Add your first investor to start tracking their capital and profit."
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
          <TableSkeleton rows={8} columns={8} />
        )}
      </Card>
    </div>
  );
}

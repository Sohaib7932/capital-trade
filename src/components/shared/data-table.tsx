"use client";

import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type SortFn,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toDecimal } from "@/lib/calculations";
import { cn } from "@/lib/utils";

export interface DataTableColumnMeta {
  align?: "left" | "right" | "center";
  /** Extra classes for body cells in this column. */
  className?: string;
}

/** Sorts decimal strings (money, lots, prices) numerically. Use with `sortFn: "decimal"`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sortFn_decimal: SortFn<any, any> = (a, b, columnId) =>
  toDecimal(a.getValue<string>(columnId)).comparedTo(toDecimal(b.getValue<string>(columnId)));

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, basic: sortFn_basic, decimal: sortFn_decimal },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  columnMeta: {} as DataTableColumnMeta,
});

export type DataTableFeatures = typeof features;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataTableColumn<TData extends RowData> = ColumnDef<DataTableFeatures, TData, any>;

export function columnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * Server-driven mode: the page owns sorting and paging state, fetches the
 * matching page from the API, and passes the total row count here.
 */
export interface ServerTableState {
  rowCount: number;
  pagination: PaginationState;
  onPaginationChange: (pagination: PaginationState) => void;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  /** Dim the rows while the next page loads. */
  loading?: boolean;
}

type Updater<T> = T | ((old: T) => T);
const apply = <T,>(updater: Updater<T>, old: T): T =>
  typeof updater === "function" ? (updater as (old: T) => T)(old) : updater;

interface DataTableProps<TData extends RowData> {
  columns: DataTableColumn<TData>[];
  data: TData[];
  /** Rows per page (client-side mode). Omit to show every row. */
  pageSize?: number;
  /** Sort and page on the server instead of in the browser. */
  server?: ServerTableState;
  initialSorting?: SortingState;
  /** Free-text search across all text/number columns. */
  globalFilter?: string;
  onRowClick?: (row: TData) => void;
  /** Accessible label for the row action, e.g. (row) => `Open ${row.name}`. */
  rowLabel?: (row: TData) => string;
  getRowId?: (row: TData) => string;
  /** Rendered inside <tfoot>, e.g. a totals row built with <TableRow>/<TableCell>. */
  footer?: ReactNode;
  empty?: ReactNode;
  className?: string;
}

/**
 * Sortable, optionally paginated table built on TanStack Table. Scrolls
 * horizontally on small screens.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  pageSize,
  server,
  initialSorting = [],
  globalFilter,
  onRowClick,
  rowLabel,
  getRowId,
  footer,
  empty,
  className,
}: DataTableProps<TData>) {
  const table = useTable({
    features,
    columns,
    data,
    getRowId,
    initialState: {
      sorting: initialSorting,
      pagination: { pageIndex: 0, pageSize: pageSize ?? Number.MAX_SAFE_INTEGER },
    },
    state: server
      ? { globalFilter: globalFilter ?? "", pagination: server.pagination, sorting: server.sorting }
      : { globalFilter: globalFilter ?? "" },
    globalFilterFn: "includesString",
    manualPagination: Boolean(server),
    manualSorting: Boolean(server),
    rowCount: server?.rowCount,
    // Sorting on the server starts again from page 1.
    onSortingChange: server
      ? (updater: Updater<SortingState>) => {
          server.onSortingChange(apply(updater, server.sorting));
          server.onPaginationChange({ ...server.pagination, pageIndex: 0 });
        }
      : undefined,
    onPaginationChange: server
      ? (updater: Updater<PaginationState>) => server.onPaginationChange(apply(updater, server.pagination))
      : undefined,
    autoResetPageIndex: !server,
  });

  const rows = table.getRowModel().rows;
  const totalRows = server ? server.rowCount : table.getPrePaginatedRowModel().rows.length;
  const { pageIndex } = table.state.pagination;
  const size = server ? server.pagination.pageSize : (pageSize ?? 0);
  const showPagination = size > 0 && totalRows > size;

  return (
    <div className={className}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                return (
                  <TableHead
                    key={header.id}
                    className={ALIGN[meta?.align ?? "left"]}
                    aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                          meta?.align === "right" && "flex-row-reverse",
                        )}
                      >
                        <table.FlexRender header={header} />
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3" aria-hidden />
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
                        )}
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className={cn(server?.loading && "opacity-50 transition-opacity")} aria-busy={server?.loading || undefined}>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0">
                {empty ?? <p className="py-10 text-center text-sm text-muted-foreground">No results.</p>}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(onRowClick && "cursor-pointer")}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick(row.original);
                        }
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={rowLabel?.(row.original)}
              >
                {row.getAllCells().map((cell) => {
                  const meta = cell.column.columnDef.meta;
                  return (
                    <TableCell key={cell.id} className={cn(ALIGN[meta?.align ?? "left"], meta?.className)}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
        </TableBody>
        {footer && rows.length > 0 ? <TableFooter>{footer}</TableFooter> : null}
      </Table>

      {showPagination ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
          <p>
            Showing <span className="num text-foreground">{pageIndex * size + 1}</span>–
            <span className="num text-foreground">{Math.min((pageIndex + 1) * size, totalRows)}</span> of{" "}
            <span className="num text-foreground">{totalRows}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft aria-hidden /> Previous
            </Button>
            <span className="num">
              {pageIndex + 1} / {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

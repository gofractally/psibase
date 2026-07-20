import {
    type ColumnDef,
    flexRender,
    getCoreRowModel,
    getPaginationRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

type ServerPagination = {
    pageIndex: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    onNextPage: () => void;
    onPreviousPage: () => void;
    isLoading?: boolean;
};

type ColumnClassNameMeta = {
    className?: string;
};

type DataTableProps<TData> = {
    columns: ColumnDef<TData, unknown>[];
    data: TData[];
    pageSize?: number;
    caption?: string;
    emptyMessage?: string;
    serverPagination?: ServerPagination;
};

function getColumnClassName(meta: unknown) {
    return (meta as ColumnClassNameMeta | undefined)?.className;
}

function PaginationBar({
    pageLabel,
    onPrevious,
    onNext,
    canPrevious,
    canNext,
    isLoading,
}: {
    pageLabel: string;
    onPrevious: () => void;
    onNext: () => void;
    canPrevious: boolean;
    canNext: boolean;
    isLoading?: boolean;
}) {
    return (
        <div className="flex items-center justify-between border-t px-4 py-3">
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onPrevious}
                disabled={!canPrevious || isLoading}
                className="gap-1"
            >
                <ChevronLeft className="h-4 w-4" />
                Previous
            </Button>
            <span className="bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs font-medium tabular-nums">
                {pageLabel}
            </span>
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onNext}
                disabled={!canNext || isLoading}
                className="gap-1"
            >
                Next
                <ChevronRight className="h-4 w-4" />
            </Button>
        </div>
    );
}

export function DataTable<TData>({
    columns,
    data,
    pageSize = 10,
    caption,
    emptyMessage = "No results.",
    serverPagination,
}: DataTableProps<TData>) {
    const table = useReactTable({
        data,
        columns,
        getCoreRowModel: getCoreRowModel(),
        ...(serverPagination
            ? {}
            : {
                  getPaginationRowModel: getPaginationRowModel(),
                  initialState: {
                      pagination: { pageSize },
                  },
              }),
    });

    const { pageIndex: clientPageIndex } = table.getState().pagination;
    const pageCount = table.getPageCount();
    const rows = serverPagination
        ? table.getCoreRowModel().rows
        : table.getRowModel().rows;

    const showClientPagination = !serverPagination && pageCount > 1;
    const showServerPagination =
        serverPagination &&
        (serverPagination.hasPreviousPage || serverPagination.hasNextPage);

    return (
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
            <Table>
                {caption ? (
                    <TableCaption className="sr-only">{caption}</TableCaption>
                ) : null}
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow
                            key={headerGroup.id}
                            className="bg-muted/40 hover:bg-muted/40 border-b"
                        >
                            {headerGroup.headers.map((header) => (
                                <TableHead
                                    key={header.id}
                                    className={cn(
                                        "text-muted-foreground h-11 px-4 text-xs font-semibold tracking-wide uppercase",
                                        getColumnClassName(
                                            header.column.columnDef.meta,
                                        ),
                                    )}
                                >
                                    {header.isPlaceholder
                                        ? null
                                        : flexRender(
                                              header.column.columnDef.header,
                                              header.getContext(),
                                          )}
                                </TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody
                    className={cn(
                        "[&_tr:nth-child(even)]:bg-muted/15",
                        serverPagination?.isLoading && "opacity-50",
                    )}
                >
                    {rows.length > 0 ? (
                        rows.map((row) => (
                            <TableRow key={row.id} className="border-b">
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell
                                        key={cell.id}
                                        className={cn(
                                            "px-4 py-3",
                                            getColumnClassName(
                                                cell.column.columnDef.meta,
                                            ),
                                        )}
                                    >
                                        {flexRender(
                                            cell.column.columnDef.cell,
                                            cell.getContext(),
                                        )}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow className="hover:bg-transparent">
                            <TableCell
                                colSpan={columns.length}
                                className="text-muted-foreground h-28 px-4 text-center"
                            >
                                {emptyMessage}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
            {showClientPagination && (
                <PaginationBar
                    pageLabel={`Page ${clientPageIndex + 1} of ${pageCount}`}
                    onPrevious={() => table.previousPage()}
                    onNext={() => table.nextPage()}
                    canPrevious={table.getCanPreviousPage()}
                    canNext={table.getCanNextPage()}
                />
            )}
            {showServerPagination && serverPagination && (
                <PaginationBar
                    pageLabel={`Page ${serverPagination.pageIndex + 1}`}
                    onPrevious={serverPagination.onPreviousPage}
                    onNext={serverPagination.onNextPage}
                    canPrevious={serverPagination.hasPreviousPage}
                    canNext={serverPagination.hasNextPage}
                    isLoading={serverPagination.isLoading}
                />
            )}
        </div>
    );
}

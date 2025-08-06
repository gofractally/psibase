import {
    ColumnDef,
    ColumnFiltersState,
    RowSelectionState,
    SortingState,
    VisibilityState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import * as React from "react";

import { getId } from "@/lib/getId";
import { PackageInfo } from "@/types";

import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { ScrollArea } from "@shared/shadcn/ui/scroll-area";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export const columns: ColumnDef<PackageInfo>[] = [
    {
        id: "select",
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                aria-label="Select row"
            />
        ),
        enableSorting: false,
        enableHiding: false,
    },
    {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
            <div className="capitalize">{row.getValue("name")}</div>
        ),
    },
    {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
            <div className="text-muted-foreground">
                {row.getValue("description")}
            </div>
        ),
    },
    {
        accessorKey: "file",
        header: "File",
        cell: ({ row }) => (
            <div className="text-muted-foreground">{row.getValue("file")}</div>
        ),
    },
    {
        accessorKey: "version",
        header: () => <div className="text-right ">Version</div>,
        cell: ({ row }) => {
            return (
                <div className="text-muted-foreground text-right">
                    {row.getValue("version")}
                </div>
            );
        },
    },
];

interface Props {
    packages: PackageInfo[];
    rowSelection: RowSelectionState;
    onRowSelectionChange: React.Dispatch<
        React.SetStateAction<RowSelectionState>
    >;
}

export function ConfirmationForm({
    packages,
    rowSelection,
    onRowSelectionChange,
}: Props) {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [columnFilters, setColumnFilters] =
        React.useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] =
        React.useState<VisibilityState>({});

    const table = useReactTable({
        data: packages,
        columns,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onColumnVisibilityChange: setColumnVisibility,
        onRowSelectionChange: onRowSelectionChange,
        getRowId: getId,
        state: {
            sorting,
            columnFilters,
            pagination: {
                pageSize: 999,
                pageIndex: 0,
            },
            columnVisibility,
            rowSelection,
        },
    });

    return (
        <div className="w-full">
            <div className="py-2">
                Selected packages correspond to selected boot template.
            </div>
            <div className="rounded-md border">
                <ScrollArea className="h-[600px]">
                    <Table>
                        <TableHeader>
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow key={headerGroup.id}>
                                    {headerGroup.headers.map((header) => {
                                        return (
                                            <TableHead key={header.id}>
                                                {header.isPlaceholder
                                                    ? null
                                                    : flexRender(
                                                          header.column
                                                              .columnDef.header,
                                                          header.getContext(),
                                                      )}
                                            </TableHead>
                                        );
                                    })}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {table.getRowModel().rows?.length ? (
                                table.getRowModel().rows.map((row) => (
                                    <TableRow
                                        key={row.id}
                                        data-state={
                                            row.getIsSelected() && "selected"
                                        }
                                    >
                                        {row.getVisibleCells().map((cell) => (
                                            <TableCell key={cell.id}>
                                                {flexRender(
                                                    cell.column.columnDef.cell,
                                                    cell.getContext(),
                                                )}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell
                                        colSpan={columns.length}
                                        className="h-24 text-center"
                                    >
                                        No results.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </div>
        </div>
    );
}

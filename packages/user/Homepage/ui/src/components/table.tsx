import type { ReactNode } from "react";

import { cn } from "@shared/lib/utils";

/**
 * Dense table primitives shared by every Homepage sub-app. These intentionally
 * bypass the shadcn `Table` so we can match the Explorer's 13px rows, 8px-high
 * uppercase headers and edge-to-edge borders inside a `Panel`.
 */

export const DataTable = ({
    children,
    className,
    scroll = true,
}: {
    children: ReactNode;
    className?: string;
    scroll?: boolean;
}) => (
    <div
        className={cn(
            scroll && "scrollbar-thin overflow-x-auto",
            "flex flex-1 flex-col",
            className,
        )}
    >
        {children}
    </div>
);

export const Table = ({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) => <table className={cn("w-full text-[13px]", className)}>{children}</table>;

export const THead = ({ children }: { children: ReactNode }) => (
    <thead className="bg-muted/30 border-b">{children}</thead>
);

export const Th = ({
    children,
    className,
}: {
    children?: ReactNode;
    className?: string;
}) => (
    <th
        className={cn(
            "text-muted-foreground h-8 whitespace-nowrap px-3 text-left text-[11px] font-medium uppercase tracking-wider first:pl-4 last:pr-4",
            className,
        )}
    >
        {children}
    </th>
);

export const Tr = ({
    children,
    className,
    onClick,
    selected,
}: {
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    selected?: boolean;
}) => (
    <tr
        onClick={onClick}
        data-selected={selected || undefined}
        className={cn(
            "hover:bg-accent/40 border-b transition-colors last:border-b-0",
            onClick && "cursor-pointer",
            selected && "bg-accent/60",
            className,
        )}
    >
        {children}
    </tr>
);

export const Td = ({
    children,
    className,
    colSpan,
    title,
}: {
    children?: ReactNode;
    className?: string;
    colSpan?: number;
    title?: string;
}) => (
    <td
        colSpan={colSpan}
        title={title}
        className={cn(
            "whitespace-nowrap px-3 py-1.5 align-middle first:pl-4 last:pr-4",
            className,
        )}
    >
        {children}
    </td>
);

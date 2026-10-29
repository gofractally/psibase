import type {
    PendingTransfer,
    TokenTransfer,
    TransferAction,
} from "@/lib/user-queries";
import type { UserTokenBalance } from "@shared/hooks/use-user-token-balances";
import type { LucideIcon } from "lucide-react";

import {
    ArrowDownLeft,
    ArrowUpRight,
    Coins,
    Undo2,
    XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";

import { AccountLink } from "@/components/account-link";
import { EmptyState } from "@/components/empty-state";
import { TimeAgo } from "@/components/time-ago";

import { formatNumber } from "@/lib/format";

import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const Th = ({
    children,
    className,
}: {
    children?: React.ReactNode;
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

const Td = ({
    children,
    className,
}: {
    children?: React.ReactNode;
    className?: string;
}) => (
    <td
        className={cn(
            "whitespace-nowrap px-3 py-1.5 align-middle first:pl-4 last:pr-4",
            className,
        )}
    >
        {children}
    </td>
);

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export const TokenBalances = ({
    balances,
    systemTokenId,
    isPending,
    isError,
}: {
    balances: UserTokenBalance[] | undefined;
    systemTokenId: string | null;
    isPending?: boolean;
    isError?: boolean;
}) => {
    if (isPending) {
        return (
            <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
            </div>
        );
    }
    if (isError) {
        return (
            <EmptyState className="min-h-28">
                Could not load token balances
            </EmptyState>
        );
    }
    const sorted = [...(balances ?? [])].sort((a, b) => {
        const aSys = String(a.id) === systemTokenId ? 0 : 1;
        const bSys = String(b.id) === systemTokenId ? 0 : 1;
        if (aSys !== bSys) return aSys - bSys;
        return b.balance.amount - a.balance.amount;
    });
    if (sorted.length === 0) {
        return (
            <EmptyState icon={Coins} className="min-h-28">
                You do not hold any tokens yet
            </EmptyState>
        );
    }
    return (
        <ul className="flex flex-col">
            {sorted.map((b) => {
                const isSystem = String(b.id) === systemTokenId;
                return (
                    <li
                        key={b.id}
                        className="hover:bg-accent/40 flex items-center justify-between gap-3 border-b px-4 py-2 last:border-b-0"
                    >
                        <span className="flex min-w-0 items-center gap-2">
                            <span
                                className={cn(
                                    "flex size-7 shrink-0 items-center justify-center rounded-md border font-mono text-[10px]",
                                    isSystem &&
                                        "border-primary/40 bg-primary/10 text-primary",
                                )}
                            >
                                {(b.symbol ?? String(b.id))
                                    .slice(0, 3)
                                    .toUpperCase()}
                            </span>
                            <span className="flex min-w-0 flex-col leading-tight">
                                <span className="truncate text-sm font-medium">
                                    {b.symbol
                                        ? b.symbol.toUpperCase()
                                        : `Token #${b.id}`}
                                </span>
                                <span className="text-muted-foreground font-mono text-[10px]">
                                    id {b.id}
                                    {isSystem && " · system token"}
                                </span>
                            </span>
                        </span>
                        <span className="font-mono text-sm tabular-nums">
                            {b.balance.format({ includeLabel: false })}
                        </span>
                    </li>
                );
            })}
        </ul>
    );
};

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

const ACTION_META: Record<
    TransferAction,
    { label: string; icon: LucideIcon; className: string; sign: "+" | "−" | "" }
> = {
    credited: {
        label: "Received",
        icon: ArrowDownLeft,
        className: "text-emerald-500",
        sign: "+",
    },
    debited: {
        label: "Sent",
        icon: ArrowUpRight,
        className: "text-foreground",
        sign: "−",
    },
    uncredited: {
        label: "Reclaimed",
        icon: Undo2,
        className: "text-amber-500",
        sign: "",
    },
    rejected: {
        label: "Rejected",
        icon: XCircle,
        className: "text-muted-foreground",
        sign: "",
    },
};

export const RecentTransfers = ({
    transfers,
    symbol,
    isPending,
    isError,
    errorMessage,
}: {
    transfers: TokenTransfer[] | undefined;
    symbol: string;
    isPending?: boolean;
    isError?: boolean;
    errorMessage?: string;
}) => {
    const isEmpty = !isPending && !isError && (transfers?.length ?? 0) === 0;
    const showBelowTable = isError || isEmpty;
    return (
        <div
            className={cn(
                "scrollbar-thin overflow-x-auto",
                showBelowTable && "flex flex-1 flex-col",
            )}
        >
            <table className="w-full text-[13px]">
                <thead className="bg-muted/30 border-b">
                    <tr>
                        <Th>Type</Th>
                        <Th>Counterparty</Th>
                        <Th className="text-right">Amount</Th>
                        <Th>Memo</Th>
                        <Th>Block</Th>
                        <Th>Age</Th>
                    </tr>
                </thead>
                <tbody>
                    {isPending && (
                        <tr>
                            <td colSpan={6} className="px-4 py-3">
                                <Skeleton className="h-4 w-full" />
                            </td>
                        </tr>
                    )}
                    {transfers?.map((t, i) => {
                        const m = ACTION_META[t.action] ?? ACTION_META.rejected;
                        return (
                            <tr
                                key={`${t.blockNum}-${i}`}
                                className="hover:bg-accent/40 border-b transition-colors last:border-b-0"
                            >
                                <Td>
                                    <span
                                        className={cn(
                                            "inline-flex items-center gap-1.5",
                                            m.className,
                                        )}
                                    >
                                        <m.icon className="size-3.5" />
                                        {m.label}
                                    </span>
                                </Td>
                                <Td>
                                    <AccountLink name={t.counterParty} />
                                </Td>
                                <Td
                                    className={cn(
                                        "text-right font-mono tabular-nums",
                                        m.className,
                                    )}
                                >
                                    {m.sign}
                                    {t.amount}{" "}
                                    <span className="text-muted-foreground text-xs">
                                        {symbol}
                                    </span>
                                </Td>
                                <Td className="text-muted-foreground max-w-[220px] truncate text-xs">
                                    {t.memo || "—"}
                                </Td>
                                <Td>
                                    {t.blockNum !== null ? (
                                        <Link
                                            to={`/blocks/${t.blockNum}`}
                                            className="text-primary font-mono tabular-nums hover:underline"
                                        >
                                            {formatNumber(t.blockNum)}
                                        </Link>
                                    ) : (
                                        "—"
                                    )}
                                </Td>
                                <Td className="text-muted-foreground">
                                    {t.blockTime ? (
                                        <TimeAgo time={t.blockTime} />
                                    ) : (
                                        "—"
                                    )}
                                </Td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {isError && (
                <EmptyState detail={errorMessage}>
                    Could not load transfer history
                </EmptyState>
            )}
            {isEmpty && (
                <EmptyState>
                    No {symbol} transfers recorded for this account
                </EmptyState>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
// Pending (open lines of credit)
// ---------------------------------------------------------------------------

export const PendingTransfers = ({
    user,
    pending,
    isPending,
}: {
    user: string;
    pending: PendingTransfer[] | undefined;
    isPending?: boolean;
}) => {
    if (isPending) {
        return (
            <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-4 w-full" />
            </div>
        );
    }
    if (!pending || pending.length === 0) {
        return (
            <EmptyState className="min-h-20">
                No pending credits waiting on you or your counterparties
            </EmptyState>
        );
    }
    return (
        <ul className="flex flex-col">
            {pending.map((p, i) => {
                const incoming = p.debitor === user;
                const other = incoming ? p.creditor : p.debitor;
                const label = p.symbol
                    ? p.symbol.toUpperCase()
                    : `#${p.tokenId}`;
                return (
                    <li
                        key={`${p.tokenId}-${p.creditor}-${p.debitor}-${i}`}
                        className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm last:border-b-0"
                    >
                        <span className="flex min-w-0 items-center gap-2">
                            <Badge
                                variant="outline"
                                className={cn(
                                    "shrink-0 gap-1 text-[10px]",
                                    incoming
                                        ? "text-emerald-500"
                                        : "text-amber-500",
                                )}
                            >
                                {incoming ? (
                                    <ArrowDownLeft className="size-3" />
                                ) : (
                                    <ArrowUpRight className="size-3" />
                                )}
                                {incoming ? "to claim" : "awaiting"}
                            </Badge>
                            <span className="text-muted-foreground truncate text-xs">
                                {incoming ? "from" : "to"}
                            </span>
                            <AccountLink name={other} />
                        </span>
                        <span className="shrink-0 font-mono text-sm tabular-nums">
                            {p.balance}{" "}
                            <span className="text-muted-foreground text-xs">
                                {label}
                            </span>
                        </span>
                    </li>
                );
            })}
        </ul>
    );
};

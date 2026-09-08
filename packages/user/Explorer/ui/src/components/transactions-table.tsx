import { useRef } from "react";
import { Link } from "react-router-dom";

import type { TransactionWithContext } from "@/lib/types";
import { formatNumber } from "@/lib/format";

import { AccountLink } from "@/components/account-link";
import { ActionChips } from "@/components/action-chips";
import { Hash } from "@/components/hash";
import { TimeAgo } from "@/components/time-ago";

import { cn } from "@shared/lib/utils";
import { Badge } from "@shared/shadcn/ui/badge";

interface Props {
    transactions: TransactionWithContext[];
    compact?: boolean;
    animateNew?: boolean;
    showBlock?: boolean;
    emptyMessage?: string;
    className?: string;
}

const Th = ({
    children,
    className,
}: {
    children?: React.ReactNode;
    className?: string;
}) => (
    <th
        className={cn(
            "text-muted-foreground h-8 px-3 text-left text-[11px] font-medium tracking-wider uppercase whitespace-nowrap",
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
    <td className={cn("px-3 py-1.5 align-middle whitespace-nowrap", className)}>
        {children}
    </td>
);

export const uniqueSenders = (t: TransactionWithContext) => [
    ...new Set(t.transaction.actions.map((a) => a.sender).filter(Boolean)),
];

export const TransactionsTable = ({
    transactions,
    compact = false,
    animateNew = true,
    showBlock = true,
    emptyMessage = "No transactions",
    className,
}: Props) => {
    const initialMax = useRef<number | null>(null);
    if (initialMax.current === null && transactions.length > 0) {
        initialMax.current = Math.max(...transactions.map((t) => t.blockNum));
    }

    return (
        <div className={cn("scrollbar-thin overflow-x-auto", className)}>
            <table className="w-full text-[13px]">
                <thead className="bg-muted/30 border-b">
                    <tr>
                        <Th>Transaction</Th>
                        {showBlock && <Th>Block</Th>}
                        <Th>Age</Th>
                        <Th>Sender</Th>
                        <Th>Actions</Th>
                        {!compact && (
                            <>
                                <Th className="text-right">#</Th>
                                <Th>Auth</Th>
                            </>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {transactions.length === 0 && (
                        <tr>
                            <td
                                colSpan={7}
                                className="text-muted-foreground px-3 py-8 text-center text-sm"
                            >
                                {emptyMessage}
                            </td>
                        </tr>
                    )}
                    {transactions.map((t) => {
                        const senders = uniqueSenders(t);
                        const isNew =
                            animateNew &&
                            initialMax.current !== null &&
                            t.blockNum > initialMax.current;
                        return (
                            <tr
                                key={`${t.blockNum}-${t.index}-${t.id}`}
                                className={cn(
                                    "hover:bg-accent/40 border-b transition-colors last:border-b-0",
                                    isNew && "row-enter",
                                )}
                            >
                                <Td>
                                    <Hash
                                        value={t.id}
                                        to={`/tx/${t.id}`}
                                        head={8}
                                        tail={6}
                                    />
                                    {t.isSystem && (
                                        <Badge
                                            variant="outline"
                                            className="text-muted-foreground ml-2 h-4 px-1 text-[9px] uppercase"
                                        >
                                            sys
                                        </Badge>
                                    )}
                                </Td>
                                {showBlock && (
                                    <Td>
                                        <Link
                                            to={`/blocks/${t.blockNum}`}
                                            className="text-primary font-mono tabular-nums hover:underline"
                                        >
                                            {formatNumber(t.blockNum)}
                                        </Link>
                                    </Td>
                                )}
                                <Td className="text-muted-foreground">
                                    <TimeAgo time={t.blockTime} />
                                </Td>
                                <Td>
                                    {senders.length === 0 ? (
                                        <AccountLink name="" />
                                    ) : (
                                        <span className="inline-flex items-center gap-1.5">
                                            <AccountLink name={senders[0]} />
                                            {senders.length > 1 && (
                                                <span className="text-muted-foreground text-[10px]">
                                                    +{senders.length - 1}
                                                </span>
                                            )}
                                        </span>
                                    )}
                                </Td>
                                <Td className="max-w-[420px] whitespace-normal">
                                    <ActionChips
                                        actions={t.transaction.actions}
                                        max={compact ? 2 : 3}
                                    />
                                </Td>
                                {!compact && (
                                    <>
                                        <Td className="text-right tabular-nums">
                                            {t.transaction.actions.length}
                                        </Td>
                                        <Td className="text-muted-foreground text-xs">
                                            {t.transaction.claims.length === 0
                                                ? "—"
                                                : t.transaction.claims
                                                      .map((c) => c.service)
                                                      .join(", ")}
                                        </Td>
                                    </>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

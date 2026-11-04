import type {
    ActionType,
    Transaction,
} from "@/apps/tokens/hooks/tokens-plugin/use-user-token-balance-changes";

import { ArrowDownLeft, ArrowUpRight, Undo2, X } from "lucide-react";

import { useUserTokenBalanceChanges } from "@/apps/tokens/hooks/tokens-plugin/use-user-token-balance-changes";

import { AccountCell } from "@/components/account-cell";
import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/page-header";
import { DataTable, THead, Table, Td, Th, Tr } from "@/components/table";

import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { Token } from "../hooks/tokens-plugin/use-user-token-balances";

interface Props {
    user: string;
    token: Token;
}

const ACTION_META: Record<
    ActionType,
    { label: string; icon: typeof ArrowUpRight; className: string }
> = {
    credited: {
        label: "Sent",
        icon: ArrowUpRight,
        className: "text-foreground",
    },
    debited: {
        label: "Received",
        icon: ArrowDownLeft,
        className: "text-emerald-600 dark:text-emerald-400",
    },
    uncredited: {
        label: "Returned",
        icon: Undo2,
        className: "text-muted-foreground",
    },
    rejected: {
        label: "Rejected",
        icon: X,
        className: "text-amber-600 dark:text-amber-400",
    },
};

export function CreditTable({ user, token }: Props) {
    const {
        data: transactions,
        isPending,
        isError,
        error,
    } = useUserTokenBalanceChanges(user, token);

    if (isError) console.error("ERROR:", error);

    return (
        <Panel
            title="Activity"
            description={`Recent ${token.label} credits and debits`}
        >
            {isPending ? (
                <div className="flex flex-col gap-2 p-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-6 w-full" />
                    ))}
                </div>
            ) : isError ? (
                <EmptyState className="text-destructive min-h-24">
                    Couldn't load recent activity.
                </EmptyState>
            ) : !transactions || transactions.length === 0 ? (
                <EmptyState
                    className="min-h-32"
                    detail="Transfers you send or receive will show up here."
                >
                    No activity yet
                </EmptyState>
            ) : (
                <DataTable>
                    <Table>
                        <THead>
                            <tr>
                                <Th className="w-28">Type</Th>
                                <Th>Counterparty</Th>
                                <Th className="text-right">Amount</Th>
                                <Th className="hidden md:table-cell">Memo</Th>
                            </tr>
                        </THead>
                        <tbody>
                            {transactions.map((transaction, index) => (
                                <TransactionRow
                                    key={`${transaction.counterParty}-${transaction.action}-${index}`}
                                    transaction={transaction}
                                />
                            ))}
                        </tbody>
                    </Table>
                </DataTable>
            )}
        </Panel>
    );
}

const TransactionRow = ({ transaction }: { transaction: Transaction }) => {
    const meta = ACTION_META[transaction.action];
    const Icon = meta.icon;
    const outgoing = transaction.direction === "outgoing";
    return (
        <Tr>
            <Td>
                <span
                    className={cn(
                        "inline-flex items-center gap-1.5 text-xs font-medium",
                        meta.className,
                    )}
                >
                    <Icon className="size-3.5" />
                    {meta.label}
                </span>
            </Td>
            <Td>
                <AccountCell account={transaction.counterParty} />
            </Td>
            <Td className="whitespace-nowrap text-right">
                <span
                    className={cn(
                        "font-mono tabular-nums",
                        transaction.action === "debited" &&
                            "text-emerald-600 dark:text-emerald-400",
                    )}
                >
                    {outgoing ? "−" : "+"}
                    {transaction.amount?.format({
                        fullPrecision: true,
                        includeLabel: false,
                    })}
                </span>{" "}
                <span
                    className={cn(
                        "text-muted-foreground text-xs",
                        !transaction.amount?.hasTokenSymbol() && "italic",
                    )}
                >
                    {transaction.amount.getDisplayLabel()}
                </span>
            </Td>
            <Td
                className="text-muted-foreground hidden max-w-64 truncate text-xs md:table-cell"
                title={transaction.memo || undefined}
            >
                {transaction.memo || <span className="opacity-40">—</span>}
            </Td>
        </Tr>
    );
};

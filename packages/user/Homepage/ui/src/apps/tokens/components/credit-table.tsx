import type {
    ActionType,
    Transaction,
} from "@/apps/tokens/hooks/tokensPlugin/use-user-token-balance-changes";

import { ArrowDown, ArrowUp, ReceiptText, Undo2, X } from "lucide-react";

import { useUserTokenBalanceChanges } from "@/apps/tokens/hooks/tokensPlugin/use-user-token-balance-changes";

import { Loading } from "@/components/loading";

import { ErrorCard } from "@shared/components/error-card";
import { GlowingCard } from "@shared/components/glowing-card";
import { TableContact } from "@shared/components/tables/table-contact";
import { cn } from "@shared/lib/utils";
import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableRow,
} from "@shared/shadcn/ui/table";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import { Token } from "../hooks/tokensPlugin/use-user-token-balances";

interface Props {
    user: string;
    token: Token;
}

export function CreditTable({ user, token }: Props) {
    const {
        data: transactions,
        isPending,
        isError,
        error,
    } = useUserTokenBalanceChanges(user, token);

    if (isPending) {
        return (
            <GlowingCard>
                <Loading />
            </GlowingCard>
        );
    }

    if (isError) {
        console.error("ERROR:", error);
        const errorMessage =
            "Failed to load recent transactions. See logs for more details.";
        return (
            <GlowingCard>
                <ErrorCard error={new Error(errorMessage)} />
            </GlowingCard>
        );
    }

    if (transactions?.length === 0) {
        return (
            <GlowingCard>
                <CardContent className="text-muted-foreground py-8 text-center">
                    No transactions to display
                </CardContent>
            </GlowingCard>
        );
    }

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent className="@container">
                <Table>
                    <TableCaption>
                        A list of your credit and debits.
                    </TableCaption>
                    <TableBody>
                        {transactions?.map((transaction, index) => {
                            return (
                                <TableRow
                                    key={`${transaction.counterParty}-${transaction.action}-${index}`}
                                >
                                    <TableCell
                                        className="w-6 text-center"
                                        title={transaction.action}
                                    >
                                        <CellAction
                                            action={transaction.action}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <TableContact
                                            account={transaction.counterParty}
                                        />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <CellAmount transaction={transaction} />
                                    </TableCell>
                                    <TableCell className="h-full w-6 text-center">
                                        <CellMemo memo={transaction.memo} />
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </CardContent>
        </GlowingCard>
    );
}

const CellAction = ({ action }: { action: ActionType }) => {
    return (
        <Tooltip>
            <TooltipContent>
                {action.charAt(0).toUpperCase() + action.slice(1)}
            </TooltipContent>
            {action === "credited" ? (
                <TooltipTrigger className="block">
                    <ArrowUp className="h-4 w-4" />
                </TooltipTrigger>
            ) : action === "debited" ? (
                <TooltipTrigger className="block">
                    <ArrowDown className="h-4 w-4" />
                </TooltipTrigger>
            ) : action === "uncredited" ? (
                <TooltipTrigger className="block">
                    <Undo2 className="h-4 w-4" />
                </TooltipTrigger>
            ) : action === "rejected" ? (
                <TooltipTrigger className="block">
                    <X className="h-4 w-4" />
                </TooltipTrigger>
            ) : null}
        </Tooltip>
    );
};

const CellAmount = ({ transaction }: { transaction: Transaction }) => {
    return (
        <>
            <span className="font-mono">
                {transaction.direction === "outgoing" && "-"}
                {transaction?.amount?.format({
                    fullPrecision: true,
                    includeLabel: false,
                })}
            </span>{" "}
            <span
                className={cn(
                    "text-muted-foreground",
                    !transaction?.amount?.hasTokenSymbol() && "italic",
                )}
            >
                {transaction?.amount.getDisplayLabel()}
            </span>
        </>
    );
};

const CellMemo = ({ memo }: { memo: string }) => {
    if (!memo) return null;
    return (
        <Tooltip>
            <TooltipContent>{memo}</TooltipContent>
            <TooltipTrigger className="block">
                <ReceiptText className="h-4 w-4" />
            </TooltipTrigger>
        </Tooltip>
    );
};

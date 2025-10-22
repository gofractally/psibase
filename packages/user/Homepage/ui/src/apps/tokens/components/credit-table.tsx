import { ArrowDown, ArrowUp, ReceiptText, Undo2, X } from "lucide-react";

import { useUserTokenBalanceChanges } from "@/apps/tokens/hooks/tokensPlugin/use-user-token-balance-changes";

import { GlowingCard } from "@/components/glowing-card";

import { Avatar } from "@shared/components/avatar";
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
    const { data: transactions, isPending } = useUserTokenBalanceChanges(
        user,
        token,
    );

    if (isPending) {
        return (
            <GlowingCard>
                <CardContent className="text-muted-foreground py-8 text-center">
                    Loading recent transactions...
                </CardContent>
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
            <CardContent>
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
                                        <Tooltip>
                                            <TooltipContent>
                                                {transaction.action
                                                    .charAt(0)
                                                    .toUpperCase() +
                                                    transaction.action.slice(1)}
                                            </TooltipContent>
                                            {transaction.action ===
                                            "credited" ? (
                                                <TooltipTrigger className="block">
                                                    <ArrowUp className="h-4 w-4" />
                                                </TooltipTrigger>
                                            ) : transaction.action ===
                                              "debited" ? (
                                                <TooltipTrigger className="block">
                                                    <ArrowDown className="h-4 w-4" />
                                                </TooltipTrigger>
                                            ) : transaction.action ===
                                              "uncredited" ? (
                                                <TooltipTrigger className="block">
                                                    <Undo2 className="h-4 w-4" />
                                                </TooltipTrigger>
                                            ) : transaction.action ===
                                              "rejected" ? (
                                                <TooltipTrigger className="block">
                                                    <X className="h-4 w-4" />
                                                </TooltipTrigger>
                                            ) : null}
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Avatar
                                                account={
                                                    transaction.counterParty
                                                }
                                                className="h-5 w-5"
                                                alt="Counterparty avatar"
                                            />
                                            {transaction.counterParty}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {transaction.direction === "incoming" &&
                                            "+"}
                                        {transaction?.amount?.format({
                                            fullPrecision: false,
                                        })}
                                    </TableCell>
                                    <TableCell className="h-full w-6 text-center">
                                        {transaction.memo && (
                                            <Tooltip>
                                                <TooltipContent>
                                                    {transaction.memo}
                                                </TooltipContent>
                                                <TooltipTrigger className="block">
                                                    <ReceiptText className="h-4 w-4" />
                                                </TooltipTrigger>
                                            </Tooltip>
                                        )}
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

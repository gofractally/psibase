import type {
    ActionType,
    Transaction,
} from "@/apps/tokens/hooks/tokensPlugin/use-user-token-balance-changes";

import { ArrowDown, ArrowUp, ReceiptText, Undo2, X } from "lucide-react";

import { useContacts } from "@/apps/contacts/hooks/use-contacts";
import { useUserTokenBalanceChanges } from "@/apps/tokens/hooks/tokensPlugin/use-user-token-balance-changes";

import { GlowingCard } from "@/components/glowing-card";

import { Avatar } from "@shared/components/avatar";
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
                                        <CellCounterparty
                                            counterParty={
                                                transaction.counterParty
                                            }
                                            user={user}
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

const CellCounterparty = ({
    counterParty,
    user,
}: {
    counterParty: string;
    user: string;
}) => {
    const { data: contacts } = useContacts(user);
    const contact = contacts?.find(
        (contact) => contact.account === counterParty,
    );
    return (
        <div className="@lg:h-auto flex h-10 items-center gap-2">
            <Avatar
                account={counterParty}
                className="@lg:h-5 @lg:w-5 h-8 w-8"
                alt="Counterparty avatar"
            />
            {contact?.nickname ? (
                <div className="@lg:flex-row @lg:gap-1 flex flex-col">
                    <div className="font-medium">{contact.nickname}</div>
                    <div className="text-muted-foreground italic">
                        {counterParty}
                    </div>
                </div>
            ) : (
                <div className="italic">{counterParty}</div>
            )}
        </div>
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

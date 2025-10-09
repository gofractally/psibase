import { HandCoins, Undo2 } from "lucide-react";
import { useOutletContext } from "react-router-dom";

import { GlowingCard } from "@/components/glowing-card";

import { Button } from "@shared/shadcn/ui/button";
import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import { useUserLinesOfCredit } from "./hooks/tokensPlugin/useUserLinesOfCredit";
import { TokensOutletContext } from "./layout";

export const PendingPage = () => {
    const context = useOutletContext<TokensOutletContext>();
    if (!context) return <div>No context</div>;
    return <PendingPageContents />;
};

export const PendingPageContents = () => {
    const context = useOutletContext<TokensOutletContext>();
    const { currentUser, isLoading } = context;

    const { data: pendingTransactions } = useUserLinesOfCredit(currentUser);

    if (isLoading) {
        return (
            <GlowingCard>
                <CardContent className="text-muted-foreground py-8 text-center">
                    Loading pending transactions...
                </CardContent>
            </GlowingCard>
        );
    }

    if (!pendingTransactions || pendingTransactions.length === 0) {
        return (
            <GlowingCard>
                <CardContent className="text-muted-foreground py-8 text-center">
                    No pending transactions
                </CardContent>
            </GlowingCard>
        );
    }

    return (
        <div className="space-y-4">
            <GlowingCard>
                <CardHeader>
                    <CardTitle>Pending Transactions</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Counterparty</TableHead>
                                <TableHead className="text-right">
                                    Claimable
                                </TableHead>
                                <TableHead className="text-right">
                                    Recallable
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {pendingTransactions.map((pt, index) => (
                                <TableRow key={`${pt.counterParty}-${index}`}>
                                    <TableCell className="font-medium">
                                        {pt.counterParty}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {pt.debit ? (
                                                <>
                                                    {pt.debit.balance.format({
                                                        fullPrecision: false,
                                                    })}
                                                    <Tooltip>
                                                        <TooltipContent>
                                                            Claim Pending
                                                        </TooltipContent>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6"
                                                                onClick={() => {
                                                                    // TODO: Implement claim logic
                                                                    console.log(
                                                                        "Claim:",
                                                                        pt,
                                                                    );
                                                                }}
                                                            >
                                                                <HandCoins className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                    </Tooltip>
                                                </>
                                            ) : (
                                                <span className="text-muted-foreground">
                                                    -
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {pt.credit ? (
                                                <>
                                                    {pt.credit.balance.format({
                                                        fullPrecision: false,
                                                    })}
                                                    <Tooltip>
                                                        <TooltipContent>
                                                            Recall Available
                                                        </TooltipContent>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-6 w-6"
                                                                onClick={() => {
                                                                    // TODO: Implement recall logic
                                                                    console.log(
                                                                        "Recall:",
                                                                        pt,
                                                                    );
                                                                }}
                                                            >
                                                                <Undo2 className="h-4 w-4" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                    </Tooltip>
                                                </>
                                            ) : (
                                                <span className="text-muted-foreground">
                                                    -
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </GlowingCard>
        </div>
    );
};

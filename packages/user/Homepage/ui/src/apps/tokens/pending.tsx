import { ArrowDown, Loader2, Undo2, X } from "lucide-react";
import { useOutletContext } from "react-router-dom";

import { GlowingCard } from "@/components/glowing-card";

import { Button } from "@shared/shadcn/ui/button";
import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import { toast } from "@shared/shadcn/ui/sonner";
import {
    Table,
    TableBody,
    TableCaption,
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

import { useDebit } from "./hooks/tokensPlugin/useDebit";
import { useReject } from "./hooks/tokensPlugin/useReject";
import { useUncredit } from "./hooks/tokensPlugin/useUncredit";
import {
    type LineOfCredit,
    useUserLinesOfCredit,
} from "./hooks/tokensPlugin/useUserLinesOfCredit";
import { TokensOutletContext } from "./layout";

interface PendingAction {
    currentUser: string | null;
    pt: LineOfCredit;
    counterParty: string;
}

export const PendingPage = () => {
    const context = useOutletContext<TokensOutletContext>();
    if (!context) return <div>No context</div>;
    return <PendingPageContents />;
};

export const PendingPageContents = () => {
    const context = useOutletContext<TokensOutletContext>();
    const { currentUser, isLoading, selectedToken } = context;

    const { data } = useUserLinesOfCredit(currentUser);
    const pendingTransactions = data?.filter(
        (pt) =>
            pt.credit?.balance.tokenNumber === selectedToken.id ||
            pt.debit?.balance.tokenNumber === selectedToken.id,
    );

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
                    No pending transactions to display
                </CardContent>
            </GlowingCard>
        );
    }

    return (
        <GlowingCard>
            <CardHeader>
                <CardTitle>Pending Transactions</CardTitle>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableCaption>
                        A list of your pending transactions.
                    </TableCaption>
                    <TableHeader>
                        <TableRow>
                            <TableHead></TableHead>
                            <TableHead className="text-right">
                                Incoming
                            </TableHead>
                            <TableHead className="text-right">
                                Outgoing
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
                                                <div className="flex gap-1">
                                                    <AcceptButton
                                                        currentUser={
                                                            currentUser
                                                        }
                                                        pt={pt.debit}
                                                        counterParty={
                                                            pt.counterParty
                                                        }
                                                    />
                                                    <RejectButton
                                                        currentUser={
                                                            currentUser
                                                        }
                                                        pt={pt.debit}
                                                        counterParty={
                                                            pt.counterParty
                                                        }
                                                    />
                                                </div>
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
                                                <CancelButton
                                                    currentUser={currentUser}
                                                    pt={pt.credit}
                                                    counterParty={
                                                        pt.counterParty
                                                    }
                                                />
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
    );
};

const AcceptButton = ({ currentUser, pt, counterParty }: PendingAction) => {
    const { mutateAsync, isPending } = useDebit(currentUser, counterParty);

    const handleClaim = async (pt: LineOfCredit) => {
        try {
            await mutateAsync({
                tokenId: pt.balance.tokenNumber.toString(),
                sender: pt.creditor,
                amount: pt.balance.amount.toString(),
                memo: "",
            });
            toast.success("Pending balance successfully claimed");
        } catch (e) {
            toast.error("Failed to claim pending balance", {
                closeButton: true,
                richColors: true,
                duration: Infinity,
                description:
                    e instanceof Error
                        ? e.message
                        : `Unrecognised error, see logs.`,
            });
        }
    };

    return (
        <Tooltip>
            <TooltipContent>Accept</TooltipContent>
            <TooltipTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    disabled={isPending}
                    onClick={() => handleClaim(pt)}
                >
                    {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <ArrowDown className="h-4 w-4" />
                    )}
                </Button>
            </TooltipTrigger>
        </Tooltip>
    );
};

const CancelButton = ({ currentUser, pt, counterParty }: PendingAction) => {
    const { mutateAsync, isPending } = useUncredit(currentUser, counterParty);

    const handleRecall = async (pt: LineOfCredit) => {
        try {
            await mutateAsync({
                tokenId: pt.balance.tokenNumber.toString(),
                debitor: pt.debitor,
                amount: pt.balance.amount.toString(),
                memo: "",
            });
            toast.success("Pending balance successfully recalled");
        } catch (e) {
            toast.error("Failed to recall pending balance", {
                closeButton: true,
                richColors: true,
                duration: Infinity,
                description:
                    e instanceof Error
                        ? e.message
                        : `Unrecognised error, see logs.`,
            });
        }
    };

    return (
        <Tooltip>
            <TooltipContent>Cancel</TooltipContent>
            <TooltipTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    disabled={isPending}
                    onClick={() => handleRecall(pt)}
                >
                    {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Undo2 className="h-4 w-4" />
                    )}
                </Button>
            </TooltipTrigger>
        </Tooltip>
    );
};

const RejectButton = ({ currentUser, pt, counterParty }: PendingAction) => {
    const { mutateAsync, isPending } = useReject(currentUser, counterParty);

    const handleReject = async (pt: LineOfCredit) => {
        try {
            await mutateAsync({
                tokenId: pt.balance.tokenNumber.toString(),
                creditor: pt.creditor,
                memo: "",
            });
            toast.success("Pending balance successfully rejected");
        } catch (e) {
            toast.error("Failed to reject pending balance", {
                closeButton: true,
                richColors: true,
                duration: Infinity,
                description:
                    e instanceof Error
                        ? e.message
                        : `Unrecognised error, see logs.`,
            });
        }
    };

    return (
        <Tooltip>
            <TooltipContent>Reject</TooltipContent>
            <TooltipTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    disabled={isPending}
                    onClick={() => handleReject(pt)}
                >
                    {isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <X className="h-4 w-4" />
                    )}
                </Button>
            </TooltipTrigger>
        </Tooltip>
    );
};

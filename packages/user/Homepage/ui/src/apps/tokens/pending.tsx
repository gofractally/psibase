import { ArrowDown, Loader2, Undo2, X } from "lucide-react";
import { useState } from "react";
import { useOutletContext } from "react-router-dom";

import { GlowingCard } from "@/components/glowing-card";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from "@shared/shadcn/ui/button";
import { CardContent, CardHeader, CardTitle } from "@shared/shadcn/ui/card";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
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
import { zTransferFormMemo } from "./lib/transfer-form-schema";

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
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [memo, setMemo] = useState("");
    const [memoError, setMemoError] = useState<string | null>(null);

    const handleMemoChange = (value: string) => {
        setMemo(value);
        const result = zTransferFormMemo.safeParse(value);
        if (!result.success) {
            setMemoError(result.error.errors[0]?.message || "Invalid memo");
        } else {
            setMemoError(null);
        }
    };

    const handleClaim = async (pt: LineOfCredit) => {
        try {
            await mutateAsync({
                tokenId: pt.balance.tokenNumber.toString(),
                sender: pt.creditor,
                amount: pt.balance.amount.toString(),
                memo: memo,
            });
            toast.success("Pending balance successfully claimed");
            setIsDialogOpen(false);
            setMemo("");
            setMemoError(null);
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
        <>
            <Tooltip>
                <TooltipContent>Accept</TooltipContent>
                <TooltipTrigger asChild>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-6 w-6"
                        disabled={isPending}
                        onClick={() => setIsDialogOpen(true)}
                    >
                        {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <ArrowDown className="h-4 w-4" />
                        )}
                    </Button>
                </TooltipTrigger>
            </Tooltip>
            <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Accept Pending Payment
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to accept{" "}
                            {pt.balance.format({ fullPrecision: false })} from{" "}
                            {counterParty}?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="accept-memo">Memo (optional)</Label>
                        <Input
                            id="accept-memo"
                            value={memo}
                            onChange={(e) => handleMemoChange(e.target.value)}
                            placeholder="Add a note about this transaction"
                            disabled={isPending}
                        />
                        {memoError && (
                            <p className="text-destructive text-sm">
                                {memoError}
                            </p>
                        )}
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isPending || !!memoError}
                            onClick={(e) => {
                                e.preventDefault();
                                handleClaim(pt);
                            }}
                        >
                            {isPending ? "Accepting..." : "Accept"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

const CancelButton = ({ currentUser, pt, counterParty }: PendingAction) => {
    const { mutateAsync, isPending } = useUncredit(currentUser, counterParty);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [memo, setMemo] = useState("");
    const [memoError, setMemoError] = useState<string | null>(null);

    const handleMemoChange = (value: string) => {
        setMemo(value);
        const result = zTransferFormMemo.safeParse(value);
        if (!result.success) {
            setMemoError(result.error.errors[0]?.message || "Invalid memo");
        } else {
            setMemoError(null);
        }
    };

    const handleRecall = async (pt: LineOfCredit) => {
        try {
            await mutateAsync({
                tokenId: pt.balance.tokenNumber.toString(),
                debitor: pt.debitor,
                amount: pt.balance.amount.toString(),
                memo: memo,
            });
            toast.success("Pending balance successfully recalled");
            setIsDialogOpen(false);
            setMemo("");
            setMemoError(null);
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
        <>
            <Tooltip>
                <TooltipContent>Cancel</TooltipContent>
                <TooltipTrigger asChild>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-6 w-6"
                        disabled={isPending}
                        onClick={() => setIsDialogOpen(true)}
                    >
                        {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Undo2 className="h-4 w-4" />
                        )}
                    </Button>
                </TooltipTrigger>
            </Tooltip>
            <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Cancel Outgoing Payment
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to cancel your outgoing
                            payment of{" "}
                            {pt.balance.format({ fullPrecision: false })} to{" "}
                            {counterParty}?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="cancel-memo">Memo (optional)</Label>
                        <Input
                            id="cancel-memo"
                            value={memo}
                            onChange={(e) => handleMemoChange(e.target.value)}
                            placeholder="Add a note about this cancellation"
                            disabled={isPending}
                        />
                        {memoError && (
                            <p className="text-destructive text-sm">
                                {memoError}
                            </p>
                        )}
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>
                            Back
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isPending || !!memoError}
                            onClick={(e) => {
                                e.preventDefault();
                                handleRecall(pt);
                            }}
                        >
                            {isPending ? "Canceling..." : "Cancel Payment"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

const RejectButton = ({ currentUser, pt, counterParty }: PendingAction) => {
    const { mutateAsync, isPending } = useReject(currentUser, counterParty);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [memo, setMemo] = useState("");
    const [memoError, setMemoError] = useState<string | null>(null);

    const handleMemoChange = (value: string) => {
        setMemo(value);
        const result = zTransferFormMemo.safeParse(value);
        if (!result.success) {
            setMemoError(result.error.errors[0]?.message || "Invalid memo");
        } else {
            setMemoError(null);
        }
    };

    const handleReject = async (pt: LineOfCredit) => {
        try {
            await mutateAsync({
                tokenId: pt.balance.tokenNumber.toString(),
                creditor: pt.creditor,
                memo: memo,
            });
            toast.success("Pending balance successfully rejected");
            setIsDialogOpen(false);
            setMemo("");
            setMemoError(null);
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
        <>
            <Tooltip>
                <TooltipContent>Reject</TooltipContent>
                <TooltipTrigger asChild>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-6 w-6"
                        disabled={isPending}
                        onClick={() => setIsDialogOpen(true)}
                    >
                        {isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <X className="h-4 w-4" />
                        )}
                    </Button>
                </TooltipTrigger>
            </Tooltip>
            <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Reject Incoming Payment
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to reject{" "}
                            {pt.balance.format({ fullPrecision: false })} from{" "}
                            {counterParty}?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="reject-memo">Memo (optional)</Label>
                        <Input
                            id="reject-memo"
                            value={memo}
                            onChange={(e) => handleMemoChange(e.target.value)}
                            placeholder="Add a note about this rejection"
                            disabled={isPending}
                        />
                        {memoError && (
                            <p className="text-destructive text-sm">
                                {memoError}
                            </p>
                        )}
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>
                            Back
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isPending || !!memoError}
                            onClick={(e) => {
                                e.preventDefault();
                                handleReject(pt);
                            }}
                        >
                            {isPending ? "Rejecting..." : "Reject"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

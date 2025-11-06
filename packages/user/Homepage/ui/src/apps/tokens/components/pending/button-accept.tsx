import type { LineOfCredit } from "../../hooks/tokensPlugin/use-user-lines-of-credit";
import type { PendingActionProps } from "../../pending";

import { ArrowDown, Loader2 } from "lucide-react";
import { useState } from "react";

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
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { toast } from "@shared/shadcn/ui/sonner";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

import { useDebit } from "../../hooks/tokensPlugin/use-debit";
import { zTransferFormMemo } from "../../lib/transfer-form-schema";

export const AcceptButton = ({
    currentUser,
    pt,
    counterParty,
}: PendingActionProps) => {
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

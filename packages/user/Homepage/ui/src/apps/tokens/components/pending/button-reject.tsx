import type { PendingBalance } from "../../hooks/tokens-plugin/use-pending-balances";
import type { PendingActionProps } from "../../pending";

import { Loader2, X } from "lucide-react";
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

import { useReject } from "../../hooks/tokens-plugin/use-reject";
import { zTransferFormMemo } from "../../lib/transfer-form-schema";

export const RejectButton = ({
    currentUser,
    pt,
    counterParty,
}: PendingActionProps) => {
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

    const handleReject = async (pt: PendingBalance) => {
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
                        variant="ghost"
                        size="icon-xs"
                        disabled={isPending}
                        onClick={() => setIsDialogOpen(true)}
                    >
                        {isPending ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <X className="size-3.5" />
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

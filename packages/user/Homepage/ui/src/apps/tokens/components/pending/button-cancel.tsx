import type { LineOfCredit } from "../../hooks/tokensPlugin/use-user-lines-of-credit";
import type { PendingActionProps } from "../../pending";

import { Loader2, Undo2 } from "lucide-react";
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

import { useUncredit } from "../../hooks/tokensPlugin/use-uncredit";
import { zTransferFormMemo } from "../../lib/transfer-form-schema";

export const CancelButton = ({
    currentUser,
    pt,
    counterParty,
}: PendingActionProps) => {
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

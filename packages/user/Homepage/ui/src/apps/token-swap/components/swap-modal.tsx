import { ArrowDown, Loader2 } from "lucide-react";
import { useBoolean } from "usehooks-ts";
import z from "zod";

import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@shared/shadcn/ui/alert-dialog";
import { Button } from "@shared/shadcn/ui/button";

import { useSwap } from "../hooks/use-swap";
import { useToken } from "../hooks/use-token";
import { AmountSummary } from "./amount-summary";

export const ConfirmSwapModal = ({
    show,
    openChange,
    poolIds,
    minimumReturn,
    fromAmount,
    fromTokenId,
    toTokenId,
    expectedReturn,
    isHighSlippage = false,
    onSuccess,
}: {
    show: boolean;
    openChange: (show: boolean) => void;
    poolIds?: string[];
    expectedReturn?: string;
    isHighSlippage: boolean;
    minimumReturn?: string;
    fromAmount?: string;
    fromTokenId?: number;
    toTokenId?: number;
    onSuccess?: () => void;
}) => {
    const { mutateAsync: swap, isPending } = useSwap();

    const {
        toggle: toggleUserAcceptsSlippage,
        value: isUserAcceptingOfSlippage,
    } = useBoolean(false);
    const blockDueToSlippage = isHighSlippage && !isUserAcceptingOfSlippage;

    const { data: fromToken } = useToken(fromTokenId);
    const { data: toToken } = useToken(toTokenId);

    const triggerSwap = async () => {
        await swap([
            z.string().array().parse(poolIds),
            {
                amount: z.string().parse(fromAmount),
                tokenId: z.number().parse(fromTokenId),
            },
            z.string().parse(minimumReturn),
        ]);
        if (onSuccess) {
            onSuccess();
        }
        openChange(false);
    };

    return (
        <AlertDialog open={show}>
            <AlertDialogContent className="max-w-md">
                <AlertDialogHeader className="text-center">
                    <AlertDialogTitle className="text-lg font-semibold tracking-tight">
                        Confirm Swap
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-muted-foreground">
                        Please review the details before confirming your trade.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="mt-3 space-y-4">
                    {/* From Account */}
                    <AmountSummary
                        amount={Number(fromAmount).toString() || ""}
                        avatarSeed={fromToken?.toString() ?? "?"}
                        label="From"
                        title={fromToken?.symbol || `ID: ${fromTokenId}`}
                    />

                    {/* Arrow */}
                    <div className="flex justify-center">
                        <ArrowDown className="text-muted-foreground" />
                    </div>

                    {/* To Account */}
                    <AmountSummary
                        amount={Number(expectedReturn).toString() ?? ""}
                        avatarSeed={toToken?.toString() ?? "?"}
                        label="To"
                        title={toToken?.symbol || `ID: ${toTokenId}`}
                    />
                </div>

                {/* Force user to accept slippage is it is deemed high */}
                {isHighSlippage && (
                    <label
                        htmlFor="accept-slippage"
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-300"
                    >
                        <input
                            type="checkbox"
                            id="accept-slippage"
                            checked={isUserAcceptingOfSlippage}
                            onChange={() => toggleUserAcceptsSlippage()}
                            className="mt-0.5 size-4 shrink-0 accent-amber-500"
                        />
                        <span className="flex flex-col gap-0.5 leading-tight">
                            <span className="text-sm font-medium">
                                This trade involves high slippage.
                            </span>
                            <span className="text-xs opacity-80">
                                I understand and accept the reduced return.
                            </span>
                        </span>
                    </label>
                )}

                <AlertDialogFooter className="mt-6 flex-col gap-3 sm:flex-row">
                    <AlertDialogCancel
                        onClick={() => {
                            openChange(false);
                        }}
                        className="order-2 w-full sm:order-1 sm:w-auto"
                    >
                        Cancel
                    </AlertDialogCancel>
                    <Button
                        type="button"
                        onClick={() => {
                            triggerSwap();
                        }}
                        disabled={isPending || blockDueToSlippage}
                        className="order-1 sm:order-2"
                    >
                        {isPending ? (
                            <div className="flex items-center gap-2">
                                <Loader2 className="size-4 animate-spin" />
                                Swapping...
                            </div>
                        ) : (
                            "Confirm Swap"
                        )}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

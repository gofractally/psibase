import { ArrowDown } from "lucide-react";
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

import { usePools } from "../hooks/use-pools";
import { useSwap } from "../hooks/use-swap";
import { AmountSummary } from "./amount-summary";

export const ConfirmSwapModal = ({
    show,
    openChange,
    poolIds,
    minimumReturn,
    fromAmount,
    fromToken,
    toToken,
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
    fromToken?: number;
    toToken?: number;
    onSuccess?: () => void;
}) => {
    const { mutateAsync: swap, isPending } = useSwap();

    const {
        toggle: toggleUserAcceptsSlippage,
        value: isUserAcceptingOfSlippage,
    } = useBoolean(false);
    const blockDueToSlippage = isHighSlippage && !isUserAcceptingOfSlippage;

    const triggerSwap = async () => {
        await swap([
            z.string().array().parse(poolIds),
            {
                amount: z.string().parse(fromAmount),
                tokenId: z.number().parse(fromToken),
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
                    <AlertDialogTitle className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                        Confirm Swap
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
                        Please review the details before confirming your trade.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="mt-3 space-y-4">
                    {/* From Account */}
                    <AmountSummary
                        amount={fromAmount || ""}
                        avatarSeed={fromToken?.toString() ?? "?"}
                        label="From"
                        title={fromToken?.toString() ?? "?"}
                    />

                    {/* Arrow */}
                    <div className="flex justify-center">
                        <ArrowDown className="text-slate-600 dark:text-slate-400" />
                    </div>

                    {/* To Account */}
                    <AmountSummary
                        amount={expectedReturn ?? ""}
                        avatarSeed={toToken?.toString() ?? "?"}
                        label="To"
                        title={toToken?.toString() ?? "?"}
                    />
                </div>

                {/* Force user to accept slippage is it is deemed high */}
                {isHighSlippage && (
                    <div
                        className="cursor-pointer rounded-xl border border-yellow-200 bg-yellow-50 p-4 transition-colors hover:bg-yellow-100 dark:border-yellow-700/30 dark:bg-yellow-900/20 dark:hover:bg-yellow-900/30"
                        onClick={() => toggleUserAcceptsSlippage()}
                    >
                        <div className="flex items-start gap-3">
                            <div className="shrink-0">
                                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-800/30">
                                    <span className="text-sm font-bold text-yellow-700 dark:text-yellow-300">
                                        !
                                    </span>
                                </div>
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                                    This trade involves high slippage.
                                </p>
                                <div className="mt-2 flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="add-to-contacts"
                                        checked={isUserAcceptingOfSlippage}
                                        onChange={(e) => {
                                            e.stopPropagation();
                                            toggleUserAcceptsSlippage();
                                        }}
                                        className="h-4 w-4 rounded border-yellow-300 text-yellow-600 focus:ring-yellow-500 dark:border-yellow-600/50 dark:bg-yellow-800/20 dark:ring-yellow-500/50"
                                    />
                                    <label
                                        htmlFor="add-to-contacts"
                                        className="cursor-pointer text-sm text-yellow-800 dark:text-yellow-200"
                                    >
                                        I accept the poor slippage returns.
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
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
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-transparent"></div>
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

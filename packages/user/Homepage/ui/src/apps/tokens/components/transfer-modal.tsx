import type { Token } from "@/apps/tokens/hooks/tokensPlugin/use-user-token-balances";

import { useStore } from "@tanstack/react-form";
import { ArrowDown } from "lucide-react";
import { useMemo } from "react";

import { Quantity } from "@/apps/tokens/lib/quantity";

import { useCurrentUser } from "@/hooks/use-current-user";

import { Avatar } from "@shared/components/avatar";
import { withForm } from "@shared/components/form/app-form";
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

import { defaultTransferValues } from "../lib/transfer-form-schema";

export const TransferModal = withForm({
    defaultValues: defaultTransferValues,
    props: {
        open: false,
        onClose: () => {},
        selectedToken: undefined as Token | undefined,
        onSubmit: () => {},
    },
    render: function TransferModal({
        form,
        open,
        onClose,
        selectedToken,
        onSubmit,
    }) {
        const { data: currentUser } = useCurrentUser();

        const [to, amount, isSubmitting] = useStore(form.store, (state) => [
            state.values.to.account,
            state.values.amount,
            state.isSubmitting,
        ]);

        const quantity = useMemo(() => {
            if (!selectedToken) return null;
            const { precision, id, symbol } = selectedToken;
            try {
                return new Quantity(amount.amount, precision, id, symbol);
            } catch (error) {
                console.log(error);
                return null;
            }
        }, [amount.amount, selectedToken]);

        if (!quantity) return <></>;

        return (
            <AlertDialog open={open}>
                <AlertDialogContent className="max-w-md">
                    <AlertDialogHeader className="text-center">
                        <AlertDialogTitle className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                            Confirm Transfer
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-600 dark:text-slate-400">
                            Please review the details before confirming your
                            transfer
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="my-6 space-y-4 sm:flex sm:items-center sm:gap-4 sm:space-y-0">
                        {/* From Account */}
                        <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-1 dark:border-slate-700 dark:bg-slate-800">
                            <div className="flex-shrink-0">
                                <Avatar
                                    account={currentUser || ""}
                                    className="h-12 w-12"
                                    alt="From account"
                                />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                    From
                                </p>
                                <p className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
                                    {currentUser}
                                </p>
                            </div>
                        </div>

                        {/* Arrow */}
                        <div className="flex justify-center">
                            <ArrowDown className="text-slate-600 sm:-rotate-90 dark:text-slate-400" />
                        </div>

                        {/* To Account */}
                        <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-1 dark:border-slate-700 dark:bg-slate-800">
                            <div className="flex-shrink-0">
                                <Avatar
                                    account={to}
                                    className="h-12 w-12"
                                    alt="To account"
                                />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                                    To
                                </p>
                                <p className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
                                    {to}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Amount Display */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-700 dark:bg-slate-800">
                        <p className="mb-2 text-sm font-medium text-blue-600 dark:text-blue-400">
                            Transfer Amount
                        </p>
                        <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">
                            {quantity.format()}
                        </p>
                    </div>

                    <AlertDialogFooter className="mt-6 flex-col gap-3 sm:flex-row">
                        <AlertDialogCancel
                            onClick={() => onClose()}
                            className="order-2 w-full sm:order-1 sm:w-auto"
                        >
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            onClick={onSubmit}
                            disabled={isSubmitting}
                            className="order-1 sm:order-2"
                        >
                            {isSubmitting ? (
                                <div className="flex items-center gap-2">
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-500 border-t-transparent"></div>
                                    Sending...
                                </div>
                            ) : (
                                "Confirm Transfer"
                            )}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        );
    },
});

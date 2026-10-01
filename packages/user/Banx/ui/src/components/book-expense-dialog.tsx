import { useEffect } from "react";

import { useBook } from "@/hooks/use-banx-mutations";
import { displayAmount } from "@/lib/amount";
import {
    PPM_PER_PERCENT,
    ppmToPercent,
    ppmToPercentInput,
} from "@/lib/constants";
import {
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    amountFieldValidator,
    ppmRangeValidator,
    signedPercentStringToPpm,
    useAppForm,
} from "@/lib/form";
import type { BookAuth } from "@/lib/graphql";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export function BookExpenseDialog({
    open,
    onOpenChange,
    auth,
    symbol,
    precision,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    auth: BookAuth | null;
    symbol: string;
    precision: number;
}) {
    const book = useBook();
    const remaining = auth ? displayAmount(auth.remaining) : "0";
    const maxApr = auth ? ppmToPercentInput(auth.maxInterestRatePpm) : "0";

    const form = useAppForm({
        defaultValues: {
            amount: remaining,
            aprPct: maxApr,
            memo: "",
        },
        onSubmit: async ({ value }) => {
            if (!auth) return;
            await book.mutateAsync({
                debtor: auth.debtor,
                assetId: auth.assetId,
                amount: value.amount.trim(),
                interestRatePpm: signedPercentStringToPpm(
                    value.aprPct,
                    PPM_SCALE,
                ),
                memo: value.memo.trim(),
            });
            onOpenChange(false);
        },
    });

    useEffect(() => {
        if (!open || !auth) return;
        form.reset({
            amount: displayAmount(auth.remaining),
            aprPct: ppmToPercentInput(auth.maxInterestRatePpm),
            memo: "",
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, auth]);

    if (!auth) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Book expense onto {auth.debtor}</DialogTitle>
                    <DialogDescription>
                        They authorized you to record that they owe you, up to{" "}
                        {remaining} {symbol}. APR can be from{" "}
                        {ppmToPercent(-PPM_SCALE)} to{" "}
                        {ppmToPercent(auth.maxInterestRatePpm)}; a negative rate
                        decays the claim. This writes the IOU immediately.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="grid gap-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void form.handleSubmit();
                    }}
                >
                    <form.AppField
                        name="amount"
                        validators={{
                            onChange: amountFieldValidator(precision, {
                                allowZero: false,
                            }),
                            onSubmit: amountFieldValidator(precision, {
                                allowZero: false,
                            }),
                        }}
                        children={(field) => (
                            <field.TextField
                                label={`Amount (${symbol})`}
                                inputMode="decimal"
                                required
                            />
                        )}
                    />
                    <form.AppField
                        name="aprPct"
                        validators={{
                            onChange: ppmRangeValidator(
                                -PPM_SCALE,
                                auth.maxInterestRatePpm,
                            ),
                            onSubmit: ppmRangeValidator(
                                -PPM_SCALE,
                                auth.maxInterestRatePpm,
                            ),
                        }}
                        children={(field) => (
                            <field.TextField
                                label="Interest APR %"
                                inputMode="decimal"
                                min={-MAX_PERCENT}
                                max={auth.maxInterestRatePpm / PPM_PER_PERCENT}
                                step={MIN_PERCENT_STEP}
                            />
                        )}
                    />
                    <form.AppField
                        name="memo"
                        children={(field) => (
                            <field.TextField
                                label="Memo"
                                placeholder="Dinner, tickets…"
                            />
                        )}
                    />
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <form.AppForm>
                            <form.SubmitButton
                                labels={["Book expense", "Booking…"]}
                                loading={book.isPending}
                            />
                        </form.AppForm>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

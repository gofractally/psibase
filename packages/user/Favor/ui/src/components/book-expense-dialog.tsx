import { useEffect } from "react";

import { useBook } from "@/hooks/use-favor-mutations";
import { displayAmount } from "@/lib/amount";
import { amountFieldValidator, useAppForm } from "@/lib/form";
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


    const form = useAppForm({
        defaultValues: {
            amount: remaining,

            memo: "",
        },
        onSubmit: async ({ value }) => {
            if (!auth) return;
            await book.mutateAsync({
                debtor: auth.debtor,
                assetId: auth.assetId,
                amount: value.amount.trim(),

                memo: value.memo.trim(),
            });
            onOpenChange(false);
        },
    });

    useEffect(() => {
        if (!open || !auth) return;
        form.reset({
            amount: displayAmount(auth.remaining),

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
                        {`They authorized you to record that they owe you, up to ${remaining} ${symbol}.` +
                            " This writes the IOU immediately."}
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

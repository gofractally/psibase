import { useEffect } from "react";

import { useForgive } from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    formatRawAmount,
    humanToRaw,
} from "@/lib/amount";
import { amountFieldValidator, useAppForm } from "@/lib/form";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export type ForgiveTarget = {
    debtor: string;
    assetId: number;
    maxRaw: string;
    symbol: string;
    precision: number;
};

/**
 * Creditor write-off of a claim they hold. Debtor does not sign.
 * Amount is capped on chain at live exposure.
 */
export function ForgiveDialog({
    open,
    onOpenChange,
    target,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    target: ForgiveTarget | null;
}) {
    const forgive = useForgive();
    const precision = target?.precision ?? 0;
    const maxHuman = target
        ? formatRawAmount(target.maxRaw, target.precision)
        : "0";

    const form = useAppForm({
        defaultValues: { amount: maxHuman },
        onSubmit: async ({ value }) => {
            if (!target) return;
            await new Promise<void>((resolve, reject) => {
                forgive.mutate(
                    {
                        debtor: target.debtor,
                        assetId: target.assetId,
                        amount: value.amount.trim(),
                    },
                    {
                        onSuccess: () => {
                            onOpenChange(false);
                            resolve();
                        },
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    useEffect(() => {
        if (open && target) {
            form.reset({ amount: maxHuman });
        }
        // form identity is stable; reset when the dialog target changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, target?.debtor, target?.assetId, maxHuman]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Write off claim</DialogTitle>
                    <DialogDescription>
                        Drop some or all of what{" "}
                        <span className="text-foreground font-medium">
                            {target?.debtor ?? "this party"}
                        </span>{" "}
                        owes you in {target?.symbol ?? "this asset"}. They do
                        not need to sign. This cannot be undone.
                    </DialogDescription>
                </DialogHeader>

                {target ? (
                    <form
                        className="grid gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void form.handleSubmit();
                        }}
                    >
                        <p className="text-muted-foreground text-sm">
                            Outstanding{" "}
                            <span className="text-foreground font-mono tabular-nums">
                                {maxHuman} {target.symbol}
                            </span>
                        </p>

                        <form.AppField
                            name="amount"
                            validators={{
                                onChange: ({ value }) => {
                                    const base = amountFieldValidator(
                                        precision,
                                        { allowZero: false },
                                    )({ value });
                                    if (base) return base;
                                    const raw = humanToRaw(
                                        String(value),
                                        precision,
                                    );
                                    if (raw > BigInt(target.maxRaw || "0")) {
                                        return `Cannot exceed ${maxHuman} ${target.symbol}`;
                                    }
                                    return undefined;
                                },
                                onSubmit: ({ value }) =>
                                    amountFieldValidator(precision, {
                                        allowZero: false,
                                    })({ value }),
                            }}
                            children={(field) => (
                                <field.TextField
                                    label={`Amount (${target.symbol})`}
                                    inputMode="decimal"
                                    placeholder={amountPlaceholder(precision)}
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
                                    labels={["Write off", "Writing off…"]}
                                    loading={forgive.isPending}
                                />
                            </form.AppForm>
                        </DialogFooter>
                    </form>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

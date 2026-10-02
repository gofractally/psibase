import { useEffect, useState } from "react";

import { defaultAssetId } from "@/components/asset-select";
import { AssetField } from "@/components/form-fields";
import { useSetPayAuth } from "@/hooks/use-banx-mutations";
import { humanToRaw } from "@/lib/amount";
import { amountFieldValidator, useAppForm } from "@/lib/form";
import type { Asset } from "@/lib/graphql";
import {
    fromLocalInput,
    periodDaysError,
    periodSecondsFromDays,
    toLocalInput,
} from "@/lib/pay-auth";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

/**
 * Payer creates a repeating path payment to `payee`.
 * A due period is collected later; this does not post an invoice.
 */
export function PayAuthDialog({
    open,
    onOpenChange,
    payee,
    assets,
    precisionOf,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    payee: string;
    assets: Asset[];
    precisionOf: (id: number) => number;
}) {
    const create = useSetPayAuth();
    const [formError, setFormError] = useState<string | null>(null);

    const form = useAppForm({
        defaultValues: {
            assetId: undefined as number | undefined,
            amount: "",
            maxSpend: "",
            periodDays: 30,
            nextDueLocal: toLocalInput(Math.floor(Date.now() / 1000)),
            endsLocal: "",
        },
        onSubmit: async ({ value }) => {
            setFormError(null);
            if (value.assetId === undefined) {
                setFormError("Choose an asset");
                return;
            }
            const periodSeconds = periodSecondsFromDays(value.periodDays);
            if (periodSeconds === null) {
                setFormError("Enter a whole number of days");
                return;
            }
            const amount = value.amount.trim();
            const maxSpend = value.maxSpend.trim() || amount;
            const prec = precisionOf(value.assetId);
            if (humanToRaw(maxSpend, prec) < humanToRaw(amount, prec)) {
                setFormError("Max spend must cover the amount");
                return;
            }
            const nextDue = fromLocalInput(value.nextDueLocal);
            if (nextDue === null) {
                setFormError("Choose when the first period is due");
                return;
            }
            const endsAt = value.endsLocal.trim()
                ? fromLocalInput(value.endsLocal)
                : 0;
            if (endsAt === null) {
                setFormError("End date is not valid");
                return;
            }
            if (endsAt !== 0 && endsAt <= nextDue) {
                setFormError("End must be after the first due date");
                return;
            }
            await new Promise<void>((resolve, reject) => {
                create.mutate(
                    {
                        payee,
                        assetId: value.assetId!,
                        amount,
                        maxSpend,
                        periodSeconds,
                        nextDueSeconds: nextDue,
                        endsAtSeconds: endsAt,
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
        if (!open) return;
        setFormError(null);
        form.reset({
            assetId: defaultAssetId(assets),
            amount: "",
            maxSpend: "",
            periodDays: 30,
            nextDueLocal: toLocalInput(Math.floor(Date.now() / 1000)),
            endsLocal: "",
        });
        // form.reset identity changes every render
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, payee, assets]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Repeating payment</DialogTitle>
                    <DialogDescription>
                        Pay {payee} this amount every period. They can collect
                        it when it is due. Each collection draws your lines.
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
                    <form.Field
                        name="assetId"
                        children={(field) => (
                            <AssetField
                                assets={assets}
                                value={field.state.value}
                                onChange={(id) => field.handleChange(id)}
                            />
                        )}
                    />
                    <form.Subscribe
                        selector={(s) => s.values.assetId}
                        children={(assetId) => (
                            <form.AppField
                                name="amount"
                                validators={
                                    assetId !== undefined
                                        ? {
                                              onChange: amountFieldValidator(
                                                  precisionOf(assetId),
                                                  {
                                                      allowEmpty: true,
                                                      allowZero: false,
                                                  },
                                              ),
                                              onSubmit: amountFieldValidator(
                                                  precisionOf(assetId),
                                                  {
                                                      allowEmpty: false,
                                                      allowZero: false,
                                                  },
                                              ),
                                          }
                                        : undefined
                                }
                                children={(field) => (
                                    <field.TextField
                                        label="Amount each period"
                                        inputMode="decimal"
                                    />
                                )}
                            />
                        )}
                    />
                    <form.Subscribe
                        selector={(s) => s.values.assetId}
                        children={(assetId) => (
                            <form.AppField
                                name="maxSpend"
                                validators={
                                    assetId !== undefined
                                        ? {
                                              onChange: amountFieldValidator(
                                                  precisionOf(assetId),
                                                  {
                                                      allowEmpty: true,
                                                      allowZero: false,
                                                  },
                                              ),
                                          }
                                        : undefined
                                }
                                children={(field) => (
                                    <field.TextField
                                        label="Max you can be drawn"
                                        inputMode="decimal"
                                        placeholder="Same as the amount"
                                    />
                                )}
                            />
                        )}
                    />
                    <p className="text-muted-foreground -mt-2 text-xs">
                        Raise the max when hop fees make the draw larger than
                        the amount they receive.
                    </p>
                    <form.AppField
                        name="periodDays"
                        validators={{
                            onChange: ({ value }) => periodDaysError(value),
                            onSubmit: ({ value }) => periodDaysError(value),
                        }}
                        children={(field) => (
                            <field.NumberField label="Every (days)" required />
                        )}
                    />
                    <form.Field
                        name="nextDueLocal"
                        children={(field) => (
                            <div className="grid gap-2">
                                <Label htmlFor="pay-auth-first-due">
                                    First due
                                </Label>
                                <Input
                                    id="pay-auth-first-due"
                                    type="datetime-local"
                                    value={field.state.value}
                                    onChange={(e) =>
                                        field.handleChange(e.target.value)
                                    }
                                />
                            </div>
                        )}
                    />
                    <form.Field
                        name="endsLocal"
                        children={(field) => (
                            <div className="grid gap-2">
                                <Label htmlFor="pay-auth-ends">
                                    Ends (optional)
                                </Label>
                                <Input
                                    id="pay-auth-ends"
                                    type="datetime-local"
                                    value={field.state.value}
                                    onChange={(e) =>
                                        field.handleChange(e.target.value)
                                    }
                                />
                            </div>
                        )}
                    />
                    {formError ? (
                        <p className="text-destructive text-sm">{formError}</p>
                    ) : null}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={create.isPending}>
                            {create.isPending ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

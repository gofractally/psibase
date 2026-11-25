import { useEffect } from "react";

import { AssetField, amountUnit } from "@/components/form-fields";
import { useDeposit } from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    isUnitDefault,
    unitAmount,
} from "@/lib/amount";
import {
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    amountFieldValidator,
    existingAccountValidators,
    percentFieldValidator,
    percentStringToPpm,
    useAppForm,
} from "@/lib/form";
import type { Asset } from "@/lib/graphql";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

/**
 * Book a deposit (you receive funds as debtor). `initialAccount` is the
 * depositor when the caller already knows them, and the field stays hidden.
 */
export function NewDepositLoanDialog({
    open,
    onOpenChange,
    assets,
    precisionOf,
    initialAccount,
    assetId: lockedAssetId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    precisionOf: (id: number) => number;
    initialAccount?: string;
    /** Page currency. Hides the picker. */
    assetId?: number;
}) {
    const deposit = useDeposit();
    const lockedDepositor = initialAccount?.trim() || undefined;
    const amountFor = (assetId: number | undefined) =>
        assetId === undefined ? "1" : unitAmount(precisionOf(assetId));

    const form = useAppForm({
        defaultValues: {
            depositor: "",
            assetId: lockedAssetId,
            amount: amountFor(lockedAssetId),
            aprPct: "0",
        },
        onSubmit: async ({ value }) => {
            const depositor = (lockedDepositor ?? value.depositor).trim();
            if (value.assetId === undefined || !depositor) return;
            await new Promise<void>((resolve, reject) => {
                deposit.mutate(
                    {
                        depositor,
                        assetId: value.assetId!,
                        amount: value.amount.trim(),
                        interestRatePpm: percentStringToPpm(
                            value.aprPct,
                            PPM_SCALE,
                        ),
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
        form.reset({
            depositor: initialAccount?.trim() ?? "",
            assetId: lockedAssetId,
            amount: amountFor(lockedAssetId),
            aprPct: "0",
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initialAccount, lockedAssetId]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Book a deposit</DialogTitle>
                    <DialogDescription>
                        {lockedDepositor
                            ? `You received value outside Banx. You owe ${lockedDepositor}, and they hold the asset. Overlapping claims net on their own.`
                            : "You received value outside Banx. You owe the depositor, and they hold the asset. Overlapping claims net on their own."}
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
                    {!lockedDepositor ? (
                        <form.AppField
                            name="depositor"
                            validators={existingAccountValidators()}
                            children={(field) => (
                                <field.TextField
                                    label="Who holds the asset"
                                    placeholder="account"
                                    required
                                />
                            )}
                        />
                    ) : null}
                    {lockedAssetId === undefined ? (
                        <form.Field
                            name="assetId"
                            children={(field) => (
                                <AssetField
                                    assets={assets}
                                    value={field.state.value}
                                    onChange={(id) => {
                                        field.handleChange(id);
                                        const current = String(
                                            form.state.values.amount ?? "",
                                        );
                                        if (isUnitDefault(current)) {
                                            form.setFieldValue(
                                                "amount",
                                                amountFor(id),
                                            );
                                        }
                                    }}
                                />
                            )}
                        />
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                        <form.Subscribe
                            selector={(s) => s.values.assetId}
                            children={(assetId) => {
                                const symbol = assets
                                    .find((asset) => asset.id === assetId)
                                    ?.symbol.toUpperCase();
                                return (
                                <form.AppField
                                    name="amount"
                                    validators={
                                        assetId !== undefined
                                            ? {
                                                  onChange:
                                                      amountFieldValidator(
                                                          precisionOf(assetId),
                                                          {
                                                              allowZero: false,
                                                          },
                                                      ),
                                                  onSubmit:
                                                      amountFieldValidator(
                                                          precisionOf(assetId),
                                                          {
                                                              allowZero: false,
                                                          },
                                                      ),
                                              }
                                            : undefined
                                    }
                                    children={(field) => (
                                        <field.TextField
                                            label="Amount"
                                            inputMode="decimal"
                                            required
                                            placeholder={
                                                assetId !== undefined
                                                    ? amountPlaceholder(
                                                          precisionOf(assetId),
                                                      )
                                                    : undefined
                                            }
                                            endContent={amountUnit(symbol)}
                                        />
                                    )}
                                />
                                );
                            }}
                        />
                        <form.AppField
                            name="aprPct"
                            validators={{
                                onChange: percentFieldValidator(MAX_PERCENT),
                                onSubmit: percentFieldValidator(MAX_PERCENT),
                            }}
                            children={(field) => (
                                <field.TextField
                                    label="Interest APR %"
                                    inputMode="decimal"
                                    min={0}
                                    max={MAX_PERCENT}
                                    step={MIN_PERCENT_STEP}
                                />
                            )}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <form.Subscribe
                            selector={(s) => s.values.assetId}
                            children={(assetId) => (
                                <form.AppForm>
                                    <form.SubmitButton
                                        labels={[
                                            "Book deposit",
                                            "Booking…",
                                        ]}
                                        loading={deposit.isPending}
                                        disabled={assetId === undefined}
                                    />
                                </form.AppForm>
                            )}
                        />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

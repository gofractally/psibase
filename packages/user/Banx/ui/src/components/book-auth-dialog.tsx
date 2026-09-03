import { useEffect } from "react";

import { AssetField, ExpiresField } from "@/components/form-fields";
import {
    useRemoveBookAuth,
    useSetBookAuth,
} from "@/hooks/use-banx-mutations";
import { displayAmount } from "@/lib/amount";
import { ppmToPercentInput } from "@/lib/constants";
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
import type { Asset, BookAuth } from "@/lib/graphql";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export function BookAuthDialog({
    open,
    onOpenChange,
    assets,
    precisionOf,
    prefill,
    existing,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    precisionOf: (id: number) => number;
    /** Locked creditor when opened from an account row. */
    prefill?: { creditor?: string; assetId?: number };
    existing?: BookAuth | null;
}) {
    const setAuth = useSetBookAuth();
    const removeAuth = useRemoveBookAuth();
    const lockedCreditor = existing?.creditor ?? prefill?.creditor;
    const lockedAsset = existing?.assetId ?? prefill?.assetId;

    const form = useAppForm({
        defaultValues: {
            creditor: "",
            assetId: undefined as number | undefined,
            remaining: "100",
            maxAprPct: "0",
            expiresAtSeconds: 0,
        },
        onSubmit: async ({ value }) => {
            const creditor = (lockedCreditor ?? value.creditor).trim();
            const assetId = lockedAsset ?? value.assetId;
            if (assetId === undefined || !creditor) return;
            await setAuth.mutateAsync({
                creditor,
                assetId,
                remaining: value.remaining.trim(),
                maxInterestRatePpm: percentStringToPpm(
                    value.maxAprPct,
                    PPM_SCALE,
                ),
                expiresAtSeconds: value.expiresAtSeconds,
            });
            onOpenChange(false);
        },
    });

    useEffect(() => {
        if (!open) return;
        if (existing) {
            form.reset({
                creditor: existing.creditor,
                assetId: existing.assetId,
                remaining: displayAmount(existing.remaining),
                maxAprPct: ppmToPercentInput(existing.maxInterestRatePpm),
                expiresAtSeconds: existing.expiresAt,
            });
        } else {
            form.reset({
                creditor: prefill?.creditor ?? "",
                assetId: prefill?.assetId,
                remaining: "100",
                maxAprPct: "0",
                expiresAtSeconds: 0,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, existing, prefill?.creditor, prefill?.assetId]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {existing ? "Edit book-auth" : "Let them book expenses"}
                    </DialogTitle>
                    <DialogDescription>
                        They can record that you owe them, up to this remaining
                        budget — like Splitwise adding an expense. Not a path
                        payment. You can revoke anytime.
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
                    {!lockedCreditor ? (
                        <form.AppField
                            name="creditor"
                            validators={existingAccountValidators()}
                            children={(field) => (
                                <field.TextField
                                    label="Who may book"
                                    placeholder="bob"
                                    required
                                />
                            )}
                        />
                    ) : null}
                    {lockedAsset === undefined ? (
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
                    ) : null}
                    <form.Subscribe
                        selector={(s) => s.values.assetId}
                        children={(assetId) => {
                            const aid = lockedAsset ?? assetId;
                            return (
                                <form.AppField
                                    name="remaining"
                                    validators={
                                        aid !== undefined
                                            ? {
                                                  onChange:
                                                      amountFieldValidator(
                                                          precisionOf(aid),
                                                          { allowZero: false },
                                                      ),
                                                  onSubmit:
                                                      amountFieldValidator(
                                                          precisionOf(aid),
                                                          { allowZero: false },
                                                      ),
                                              }
                                            : undefined
                                    }
                                    children={(field) => (
                                        <field.TextField
                                            label="Remaining they may book"
                                            inputMode="decimal"
                                            required
                                        />
                                    )}
                                />
                            );
                        }}
                    />
                    <form.AppField
                        name="maxAprPct"
                        validators={{
                            onChange: percentFieldValidator(MAX_PERCENT),
                            onSubmit: percentFieldValidator(MAX_PERCENT),
                        }}
                        children={(field) => (
                            <field.TextField
                                label="Max APR % they may apply"
                                inputMode="decimal"
                                min={0}
                                max={MAX_PERCENT}
                                step={MIN_PERCENT_STEP}
                            />
                        )}
                    />
                    <form.Field
                        name="expiresAtSeconds"
                        children={(field) => (
                            <ExpiresField
                                value={field.state.value}
                                onChange={(s) => field.handleChange(s)}
                            />
                        )}
                    />
                    <DialogFooter>
                        {existing ? (
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={removeAuth.isPending}
                                onClick={() => {
                                    removeAuth.mutate(
                                        {
                                            creditor: existing.creditor,
                                            assetId: existing.assetId,
                                        },
                                        {
                                            onSuccess: () =>
                                                onOpenChange(false),
                                        },
                                    );
                                }}
                            >
                                {removeAuth.isPending
                                    ? "Removing…"
                                    : "Revoke"}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <form.AppForm>
                            <form.SubmitButton
                                labels={
                                    existing
                                        ? ["Update", "Saving…"]
                                        : ["Allow booking", "Saving…"]
                                }
                                loading={setAuth.isPending}
                            />
                        </form.AppForm>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

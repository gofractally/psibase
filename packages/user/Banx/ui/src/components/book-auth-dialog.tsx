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
    signedPercentFieldValidator,
    signedPercentStringToPpm,
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

const APR_ORDER_ERROR = "Lowest APR must be at or below the highest APR";

/** Floor ppm above ceiling ppm. Skipped while either field fails its own check. */
function bookAuthAprOrderError(
    minAprPct: string,
    maxAprPct: string,
): string | undefined {
    if (
        signedPercentFieldValidator(MAX_PERCENT)({ value: minAprPct }) ||
        percentFieldValidator(MAX_PERCENT)({ value: maxAprPct })
    ) {
        return undefined;
    }
    const minPpm = signedPercentStringToPpm(minAprPct, PPM_SCALE);
    const maxPpm = percentStringToPpm(maxAprPct, PPM_SCALE);
    if (minPpm > maxPpm) return APR_ORDER_ERROR;
    return undefined;
}

function bookAuthAprOrderValidator({
    value,
}: {
    value: { minAprPct: string; maxAprPct: string };
}) {
    const message = bookAuthAprOrderError(value.minAprPct, value.maxAprPct);
    if (!message) return undefined;
    return { fields: { minAprPct: message, maxAprPct: message } };
}

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
            minAprPct: "0",
            expiresAtSeconds: 0,
        },
        validators: {
            onChange: bookAuthAprOrderValidator,
        },
        onSubmit: async ({ value }) => {
            const creditor = (lockedCreditor ?? value.creditor).trim();
            const assetId = lockedAsset ?? value.assetId;
            if (assetId === undefined || !creditor) return;
            const maxInterestRatePpm = percentStringToPpm(
                value.maxAprPct,
                PPM_SCALE,
            );
            const minInterestRatePpm = signedPercentStringToPpm(
                value.minAprPct,
                PPM_SCALE,
            );
            // BookAuth::upsert rejects this with min_interest_rate above max_interest_rate.
            if (minInterestRatePpm > maxInterestRatePpm) return;
            await setAuth.mutateAsync({
                creditor,
                assetId,
                remaining: value.remaining.trim(),
                maxInterestRatePpm,
                minInterestRatePpm,
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
                minAprPct: ppmToPercentInput(existing.minInterestRatePpm),
                expiresAtSeconds: existing.expiresAt,
            });
        } else {
            form.reset({
                creditor: prefill?.creditor ?? "",
                assetId: prefill?.assetId,
                remaining: "100",
                maxAprPct: "0",
                minAprPct: "0",
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
                        Authorise party to approve deposits on your behalf up to
                        this remaining budget.
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
                        name="minAprPct"
                        validators={{
                            onChange: signedPercentFieldValidator(MAX_PERCENT),
                            onSubmit: signedPercentFieldValidator(MAX_PERCENT),
                        }}
                        children={(field) => (
                            <field.TextField
                                label="Lowest APR % they may apply"
                                inputMode="decimal"
                                min={-MAX_PERCENT}
                                max={MAX_PERCENT}
                                step={MIN_PERCENT_STEP}
                            />
                        )}
                    />
                    <form.AppField
                        name="maxAprPct"
                        validators={{
                            onChange: percentFieldValidator(MAX_PERCENT),
                            onSubmit: percentFieldValidator(MAX_PERCENT),
                        }}
                        children={(field) => (
                            <field.TextField
                                label="Highest APR % they may apply"
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

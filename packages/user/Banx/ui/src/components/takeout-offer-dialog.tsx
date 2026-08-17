import { useEffect, useMemo } from "react";

import { AssetField, ExpiresField } from "@/components/form-fields";
import { useTakeoutOffers } from "@/hooks/use-banx-data";
import {
    useRemoveGlobalTakeoutOffer,
    useRemoveTakeoutOffer,
    useSetGlobalTakeoutOffer,
    useSetTakeoutOffer,
} from "@/hooks/use-banx-mutations";
import { amountPlaceholder, displayAmount } from "@/lib/amount";
import {
    MAX_HOP_FEE_PERCENT,
    MAX_HOP_FEE_PPM,
    MIN_PERCENT_STEP,
    amountFieldValidator,
    signedPercentFieldValidator,
    signedPercentStringToPpm,
    ppmToPercentInput,
    useAppForm,
} from "@/lib/form";
import type { Asset, TakeoutOffer } from "@/lib/graphql";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export type TakeoutOfferPrefill = {
    /** Underlying debtor → specific offer. Omit for global. */
    debtor?: string;
    assetId?: number;
};

type FeeFields = {
    assetId: number | undefined;
    feeFixed: string;
    feePct: string;
    expiresAtSeconds: number;
};

const defaultFees = (assetId?: number): FeeFields => ({
    assetId,
    feeFixed: "0",
    feePct: "0",
    expiresAtSeconds: 0,
});

function offerLive(p: TakeoutOffer, nowSec: number): boolean {
    return p.expiresAt === 0 || p.expiresAt >= nowSec;
}

function feesFromOffer(p: TakeoutOffer): FeeFields {
    return {
        assetId: p.assetId,
        feeFixed: displayAmount(p.feeFixed),
        feePct: ppmToPercentInput(p.feePercentPpm),
        expiresAtSeconds: p.expiresAt,
    };
}

const takeoutSpreadValidators = {
    onChange: signedPercentFieldValidator(MAX_HOP_FEE_PERCENT),
    onSubmit: signedPercentFieldValidator(MAX_HOP_FEE_PERCENT),
};

export function TakeoutOfferDialog({
    open,
    onOpenChange,
    assets,
    prefill,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    prefill?: TakeoutOfferPrefill | null;
}) {
    const debtor = prefill?.debtor?.trim() ?? "";
    const isSpecific = !!debtor;

    const { data: offers = [] } = useTakeoutOffers();
    const setGlobal = useSetGlobalTakeoutOffer();
    const setSpecific = useSetTakeoutOffer();
    const removeGlobal = useRemoveGlobalTakeoutOffer();
    const removeSpecific = useRemoveTakeoutOffer();

    const precisionOf = (id: number) =>
        assets.find((a) => a.id === id)?.precision ?? 0;

    const nowSec = Math.floor(Date.now() / 1000);

    const existingSpecific = useMemo(() => {
        if (!debtor) return undefined;
        const matches = offers.filter(
            (p) =>
                !p.isGlobal &&
                p.debtor === debtor &&
                offerLive(p, nowSec) &&
                (prefill?.assetId === undefined ||
                    p.assetId === prefill.assetId),
        );
        if (prefill?.assetId !== undefined) {
            return matches.find((p) => p.assetId === prefill.assetId);
        }
        return matches[0];
    }, [offers, debtor, prefill?.assetId, nowSec]);

    const liveGlobalByAsset = useMemo(() => {
        const map = new Map<number, TakeoutOffer>();
        for (const p of offers) {
            if (p.isGlobal && offerLive(p, nowSec)) {
                map.set(p.assetId, p);
            }
        }
        return map;
    }, [offers, nowSec]);

    const existingGlobal = useMemo(() => {
        if (isSpecific) return undefined;
        if (prefill?.assetId !== undefined) {
            return liveGlobalByAsset.get(prefill.assetId);
        }
        return liveGlobalByAsset.values().next().value;
    }, [isSpecific, prefill?.assetId, liveGlobalByAsset]);

    const payload = (value: FeeFields) => ({
        assetId: value.assetId!,
        feeFixed: value.feeFixed.trim(),
        feePercentPpm: signedPercentStringToPpm(value.feePct, MAX_HOP_FEE_PPM),
        expiresAtSeconds: value.expiresAtSeconds,
    });

    const globalForm = useAppForm({
        defaultValues: {
            enabled: false,
            ...defaultFees(prefill?.assetId),
        },
        onSubmit: async ({ value }) => {
            const assetId = value.assetId ?? prefill?.assetId;
            if (assetId === undefined) return;
            if (!value.enabled) {
                await new Promise<void>((resolve, reject) => {
                    removeGlobal.mutate(
                        { assetId },
                        {
                            onSuccess: () => {
                                onOpenChange(false);
                                resolve();
                            },
                            onError: (e: Error) => reject(e),
                        },
                    );
                });
                return;
            }
            await new Promise<void>((resolve, reject) => {
                setGlobal.mutate(payload({ ...value, assetId }), {
                    onSuccess: () => {
                        onOpenChange(false);
                        resolve();
                    },
                    onError: (e: Error) => reject(e),
                });
            });
        },
    });

    const specificForm = useAppForm({
        defaultValues: {
            enabled: false,
            ...defaultFees(prefill?.assetId),
        },
        onSubmit: async ({ value }) => {
            const assetId = prefill?.assetId ?? value.assetId;
            if (assetId === undefined) return;
            if (!value.enabled) {
                await new Promise<void>((resolve, reject) => {
                    removeSpecific.mutate(
                        { debtor, assetId },
                        {
                            onSuccess: () => {
                                onOpenChange(false);
                                resolve();
                            },
                            onError: (e: Error) => reject(e),
                        },
                    );
                });
                return;
            }
            await new Promise<void>((resolve, reject) => {
                setSpecific.mutate(
                    { debtor, ...payload({ ...value, assetId }) },
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
        if (isSpecific) {
            if (existingSpecific) {
                specificForm.reset({
                    enabled: true,
                    ...feesFromOffer(existingSpecific),
                });
            } else {
                specificForm.reset({
                    enabled: false,
                    ...defaultFees(prefill?.assetId),
                });
            }
        } else if (existingGlobal) {
            globalForm.reset({
                enabled: true,
                ...feesFromOffer(existingGlobal),
            });
        } else {
            globalForm.reset({
                enabled: false,
                ...defaultFees(prefill?.assetId),
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        open,
        isSpecific,
        prefill?.assetId,
        debtor,
        existingSpecific,
        existingGlobal,
    ]);

    const feeFields = (
        form: typeof globalForm,
        assetId: number | undefined,
        enabled: boolean,
    ) => {
        if (!enabled || assetId === undefined) return null;
        const precision = precisionOf(assetId);
        return (
            <div className="grid gap-5">
                <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                    <form.AppField
                        name="feeFixed"
                        validators={{
                            onChange: amountFieldValidator(precision, {
                                allowZero: true,
                            }),
                            onSubmit: amountFieldValidator(precision, {
                                allowZero: true,
                            }),
                        }}
                        children={(field) => (
                            <field.TextField
                                label={`Fee fixed (${amountPlaceholder(precision)})`}
                                inputMode="decimal"
                                placeholder={amountPlaceholder(precision)}
                            />
                        )}
                    />
                    <form.AppField
                        name="feePct"
                        validators={takeoutSpreadValidators}
                        children={(field) => (
                            <field.TextField
                                label="Spread %"
                                inputMode="decimal"
                                min={-MAX_HOP_FEE_PERCENT}
                                max={MAX_HOP_FEE_PERCENT}
                                step={MIN_PERCENT_STEP}
                            />
                        )}
                    />
                </div>
                <form.Field
                    name="expiresAtSeconds"
                    children={(field) => (
                        <ExpiresField
                            value={field.state.value}
                            onChange={(v) => field.handleChange(v)}
                        />
                    )}
                />
            </div>
        );
    };

    if (isSpecific) {
        const pending = setSpecific.isPending || removeSpecific.isPending;
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Claim takeout offer</DialogTitle>
                        <DialogDescription>
                            Buy claims on <strong>{debtor}</strong>. Spread
                            is signed: positive haircuts the seller, negative
                            is a premium you pay. You need unused line
                            residual on that debtor.
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="grid gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void specificForm.handleSubmit();
                        }}
                    >
                        <specificForm.AppField
                            name="enabled"
                            children={(field) => (
                                <field.SwitchField
                                    label={`Buy claims on ${debtor}`}
                                />
                            )}
                        />
                        <specificForm.Subscribe
                            selector={(s) => s.values}
                            children={(values) =>
                                feeFields(
                                    specificForm,
                                    prefill?.assetId ?? values.assetId,
                                    values.enabled,
                                )
                            }
                        />
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                            >
                                Cancel
                            </Button>
                            <specificForm.Subscribe
                                selector={(s) => s.values}
                                children={(values) => {
                                    const nothingToDo =
                                        !values.enabled && !existingSpecific;
                                    return (
                                        <specificForm.AppForm>
                                            <specificForm.SubmitButton
                                                labels={
                                                    values.enabled
                                                        ? [
                                                              existingSpecific
                                                                  ? "Update offer"
                                                                  : "Save offer",
                                                              "Saving…",
                                                          ]
                                                        : [
                                                              "Remove offer",
                                                              "Removing…",
                                                          ]
                                                }
                                                loading={pending}
                                                disabled={
                                                    (prefill?.assetId ===
                                                        undefined &&
                                                        values.assetId ===
                                                            undefined) ||
                                                    nothingToDo
                                                }
                                            />
                                        </specificForm.AppForm>
                                    );
                                }}
                            />
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        );
    }

    const globalPending = setGlobal.isPending || removeGlobal.isPending;
    const loadGlobalForAsset = (assetId: number) => {
        const existing = liveGlobalByAsset.get(assetId);
        if (existing) {
            const fees = feesFromOffer(existing);
            globalForm.setFieldValue("enabled", true);
            globalForm.setFieldValue("feeFixed", fees.feeFixed);
            globalForm.setFieldValue("feePct", fees.feePct);
            globalForm.setFieldValue(
                "expiresAtSeconds",
                fees.expiresAtSeconds,
            );
        } else {
            globalForm.setFieldValue("enabled", false);
            globalForm.setFieldValue("feeFixed", "0");
            globalForm.setFieldValue("feePct", "0");
            globalForm.setFieldValue("expiresAtSeconds", 0);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Claim takeout offer</DialogTitle>
                    <DialogDescription>
                        Buy claims on anyone you have lined in this asset.
                        Spread is signed: positive haircuts the seller,
                        negative is a premium. Not a path-forward offer.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="grid gap-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void globalForm.handleSubmit();
                    }}
                >
                    <globalForm.Field
                        name="assetId"
                        listeners={{
                            onChange: ({ value }) => {
                                if (value === undefined) return;
                                loadGlobalForAsset(value);
                            },
                        }}
                        children={(field) => (
                            <AssetField
                                label="Asset"
                                assets={assets}
                                value={field.state.value}
                                onChange={(id) => field.handleChange(id)}
                                itemActive={(a) => liveGlobalByAsset.has(a.id)}
                            />
                        )}
                    />
                    <globalForm.AppField
                        name="enabled"
                        children={(field) => (
                            <globalForm.Subscribe
                                selector={(s) => s.values.assetId}
                                children={(assetId) => (
                                    <field.SwitchField
                                        label="Enabled"
                                        disabled={assetId === undefined}
                                    />
                                )}
                            />
                        )}
                    />
                    <globalForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) =>
                            feeFields(
                                globalForm,
                                values.assetId,
                                values.enabled,
                            )
                        }
                    />
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <globalForm.Subscribe
                            selector={(s) => s.values}
                            children={(values) => {
                                const assetId = values.assetId;
                                const hasLive =
                                    assetId !== undefined &&
                                    liveGlobalByAsset.has(assetId);
                                const nothingToDo =
                                    !values.enabled && !hasLive;
                                return (
                                    <globalForm.AppForm>
                                        <globalForm.SubmitButton
                                            labels={
                                                values.enabled
                                                    ? [
                                                          hasLive
                                                              ? "Update offer"
                                                              : "Save offer",
                                                          "Saving…",
                                                      ]
                                                    : [
                                                          "Remove offer",
                                                          "Removing…",
                                                      ]
                                            }
                                            loading={globalPending}
                                            disabled={
                                                assetId === undefined ||
                                                nothingToDo
                                            }
                                        />
                                    </globalForm.AppForm>
                                );
                            }}
                        />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

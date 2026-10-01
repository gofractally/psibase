import { useEffect, useMemo, useState } from "react";

import {
    AssetField,
    ExpiresField,
    UsingGlobalSettingsOverlay,
    amountUnit,
} from "@/components/form-fields";
import { useBuyClaimOffers } from "@/hooks/use-banx-data";
import {
    useRemoveGlobalBuyClaimOffer,
    useRemoveBuyClaimOffer,
    useSetGlobalBuyClaimOffer,
    useSetBuyClaimOffer,
    useRemoveGlobalSellClaimOffer,
    useRemoveSellClaimOffer,
    useSetGlobalSellClaimOffer,
    useSetSellClaimOffer,
} from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    displayAmount,
    formatToPrecision,
} from "@/lib/amount";
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
import type { Asset, BuyClaimOffer } from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export type BuyClaimPrefill = {
    /** Underlying debtor → specific offer. Omit for global. */
    debtor?: string;
    assetId?: number;
    /** Default buy. Sell is the poster's ask. */
    side?: "buy" | "sell";
};

type FeeFields = {
    assetId: number | undefined;
    feeFixed: string;
    feePct: string;
    remaining: string;
    expiresAtSeconds: number;
};

const defaultFees = (assetId?: number): FeeFields => ({
    assetId,
    feeFixed: "0",
    feePct: "0",
    remaining: "",
    expiresAtSeconds: 0,
});

function offerLive(p: BuyClaimOffer, nowSec: number): boolean {
    return p.expiresAt === 0 || p.expiresAt >= nowSec;
}

function feesFromOffer(p: BuyClaimOffer): FeeFields {
    return {
        assetId: p.assetId,
        feeFixed: displayAmount(p.feeFixed),
        feePct: ppmToPercentInput(p.feePercentPpm),
        remaining: displayAmount(p.remaining),
        expiresAtSeconds: p.expiresAt,
    };
}

const buyClaimSpreadValidators = {
    onChange: signedPercentFieldValidator(MAX_HOP_FEE_PERCENT),
    onSubmit: signedPercentFieldValidator(MAX_HOP_FEE_PERCENT),
};

const SAMPLE_FACE = 15;

function previewClaimProceeds(
    face: number,
    feeFixed: string,
    feePct: string,
    isSell: boolean,
): number | null {
    const fixed = Number(String(feeFixed).trim());
    const pct = Number(String(feePct).trim());
    if (!Number.isFinite(fixed) || !Number.isFinite(pct)) return null;
    if (fixed < 0 || Math.abs(pct) >= 100) return null;
    const spread = isSell ? -pct : pct;
    const afterPct = face * (1 - spread / 100);
    if (fixed >= afterPct) return null;
    const out = afterPct - fixed;
    return out > 0 ? out : null;
}

function ClaimRow({
    creditor,
    debtor,
    amount,
}: {
    creditor: string;
    debtor?: string;
    amount: string | null;
}) {
    if (amount === null || !debtor) {
        return (
            <p className="font-mono text-xs leading-relaxed">
                <span className="text-foreground font-medium">{creditor}</span>{" "}
                <span className="text-muted-foreground/50">—</span>
            </p>
        );
    }
    return (
        <p className="font-mono text-xs leading-relaxed">
            <span className="text-foreground font-medium">{debtor}</span>
            <span className="text-muted-foreground"> owes </span>
            <span className="text-foreground">{amount}</span>
            <span className="text-muted-foreground"> to </span>
            <span className="text-foreground font-medium">{creditor}</span>
        </p>
    );
}

function ClaimFeeExample({
    feeFixed,
    feePct,
    precision,
    isSell,
    you,
    other = "alice",
    debtor = "carol",
    sampleFace = SAMPLE_FACE,
}: {
    feeFixed: string;
    feePct: string;
    precision: number;
    isSell: boolean;
    you: string;
    other?: string;
    debtor?: string;
    sampleFace?: number;
}) {
    const proceeds = previewClaimProceeds(
        sampleFace,
        feeFixed,
        feePct,
        isSell,
    );
    const faceStr =
        formatToPrecision(String(sampleFace), precision) ??
        String(sampleFace);
    const proceedsStr =
        proceeds === null
            ? null
            : (formatToPrecision(
                  proceeds.toFixed(Math.max(precision, 6)),
                  precision,
              ) ?? proceeds.toFixed(precision));
    const seller = isSell ? you : other;
    const buyer = isSell ? other : you;

    return (
        <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
                <p className="text-muted-foreground font-sans text-[0.7rem] uppercase tracking-wide">
                    Before
                </p>
                <ClaimRow
                    creditor={seller}
                    debtor={debtor}
                    amount={faceStr}
                />
                <ClaimRow creditor={buyer} amount={null} />
            </div>
            <div className="space-y-1">
                <p className="text-muted-foreground font-sans text-[0.7rem] uppercase tracking-wide">
                    After
                </p>
                <ClaimRow
                    creditor={seller}
                    debtor={buyer}
                    amount={proceedsStr}
                />
                <ClaimRow
                    creditor={buyer}
                    debtor={debtor}
                    amount={faceStr}
                />
            </div>
        </div>
    );
}

export function BuyClaimOfferDialog({
    open,
    onOpenChange,
    assets,
    prefill,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    prefill?: BuyClaimPrefill | null;
}) {
    const debtor = prefill?.debtor?.trim() ?? "";
    const isSpecific = !!debtor;
    const isSell = prefill?.side === "sell";
    const { data: user } = useCurrentUser();
    const you = user?.trim() || "you";

    const { data: allOffers = [], isSuccess: offersReady } =
        useBuyClaimOffers();
    const offers = allOffers.filter((o) => (isSell ? o.isSell : o.isBuy));
    const setGlobalBuy = useSetGlobalBuyClaimOffer();
    const setSpecificBuy = useSetBuyClaimOffer();
    const removeGlobalBuy = useRemoveGlobalBuyClaimOffer();
    const removeSpecificBuy = useRemoveBuyClaimOffer();
    const setGlobalSell = useSetGlobalSellClaimOffer();
    const setSpecificSell = useSetSellClaimOffer();
    const removeGlobalSell = useRemoveGlobalSellClaimOffer();
    const removeSpecificSell = useRemoveSellClaimOffer();
    const setGlobal = isSell ? setGlobalSell : setGlobalBuy;
    const setSpecific = isSell ? setSpecificSell : setSpecificBuy;
    const removeGlobal = isSell ? removeGlobalSell : removeGlobalBuy;
    const removeSpecific = isSell ? removeSpecificSell : removeSpecificBuy;

    const precisionOf = (id: number) =>
        assets.find((a) => a.id === id)?.precision ?? 0;

    const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
    useEffect(() => {
        if (open) setNowSec(Math.floor(Date.now() / 1000));
    }, [open]);

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
        const map = new Map<number, BuyClaimOffer>();
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
        remaining: value.remaining.trim(),
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

    // `isSuccess` stays true across background refetch; only `open` flipping
    // (or the first success) should load the form. Do not depend on offer rows.
    useEffect(() => {
        if (!open || !offersReady) return;
        if (isSpecific) {
            if (existingSpecific) {
                specificForm.reset({
                    enabled: true,
                    ...feesFromOffer(existingSpecific),
                });
            } else {
                const globalOffer =
                    prefill?.assetId !== undefined
                        ? liveGlobalByAsset.get(prefill.assetId)
                        : undefined;
                specificForm.reset({
                    enabled: false,
                    ...(globalOffer
                        ? feesFromOffer(globalOffer)
                        : defaultFees(prefill?.assetId)),
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
    }, [open, offersReady]);

    const feeFields = (
        form: typeof globalForm,
        assetId: number | undefined,
        enabled: boolean,
    ) => {
        const precision =
            assetId !== undefined ? precisionOf(assetId) : 0;
        const symbol =
            assetId !== undefined
                ? assets.find((a) => a.id === assetId)?.symbol.toUpperCase()
                : undefined;
        const locked = !enabled || assetId === undefined;
        return (
            <div
                className={cn(
                    "grid gap-5 transition-opacity duration-200",
                    locked && "opacity-40",
                )}
            >
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
                                label="Fee fixed"
                                inputMode="decimal"
                                placeholder={amountPlaceholder(precision)}
                                disabled={locked}
                                endContent={amountUnit(symbol)}
                            />
                        )}
                    />
                    <form.AppField
                        name="feePct"
                        validators={buyClaimSpreadValidators}
                        children={(field) => (
                            <field.TextField
                                label="Spread %"
                                inputMode="decimal"
                                min={-MAX_HOP_FEE_PERCENT}
                                max={MAX_HOP_FEE_PERCENT}
                                step={MIN_PERCENT_STEP}
                                disabled={locked}
                            />
                        )}
                    />
                </div>
                <form.AppField
                    name="remaining"
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
                            label="Remaining face"
                            inputMode="decimal"
                            placeholder={amountPlaceholder(precision)}
                            disabled={locked}
                            endContent={amountUnit(symbol)}
                        />
                    )}
                />
                <form.Subscribe
                    selector={(s) => ({
                        feeFixed: s.values.feeFixed,
                        feePct: s.values.feePct,
                    })}
                    children={({ feeFixed, feePct }) => (
                        <ClaimFeeExample
                            feeFixed={feeFixed}
                            feePct={feePct}
                            precision={precision}
                            isSell={isSell}
                            you={you}
                            debtor={debtor || "carol"}
                        />
                    )}
                />
                <form.Field
                    name="expiresAtSeconds"
                    children={(field) => (
                        <ExpiresField
                            value={field.state.value}
                            onChange={(v) => field.handleChange(v)}
                            disabled={locked}
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
                        <DialogTitle>
                            {isSell ? "Sell-claim offer" : "Buy-claim offer"}
                        </DialogTitle>
                        <DialogDescription>
                            {isSell ? (
                                <>
                                    Sell your claims on{" "}
                                    <strong>{debtor}</strong>. Positive
                                    spread is your profit (`1` = 1% over
                                    face); negative is a discount. Buyers
                                    hit this with buy-claim.
                                </>
                            ) : (
                                <>
                                    Buy claims on <strong>{debtor}</strong>
                                    at this rate. Spread is signed: positive
                                    haircuts the seller, negative is a
                                    premium you pay. At take they must know
                                    you, and new exposure needs your credit
                                    line to them with enough capacity.
                                </>
                            )}
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
                                    label={
                                        isSell
                                            ? `Sell claims on ${debtor}`
                                            : `Buy claims on ${debtor}`
                                    }
                                />
                            )}
                        />
                        <specificForm.Subscribe
                            selector={(s) => s.values}
                            children={(values) => {
                                const assetId =
                                    prefill?.assetId ?? values.assetId;
                                const globalOffer =
                                    assetId !== undefined
                                        ? liveGlobalByAsset.get(assetId)
                                        : undefined;
                                return (
                                    <UsingGlobalSettingsOverlay
                                        active={
                                            !values.enabled &&
                                            !!globalOffer &&
                                            !existingSpecific
                                        }
                                    >
                                        {feeFields(
                                            specificForm,
                                            assetId,
                                            values.enabled,
                                        )}
                                    </UsingGlobalSettingsOverlay>
                                );
                            }}
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
                                                labels={["Save", "Saving…"]}
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
    const lockedSymbol =
        prefill?.assetId !== undefined
            ? assets
                  .find((asset) => asset.id === prefill.assetId)
                  ?.symbol.toUpperCase()
            : undefined;

    const loadGlobalForAsset = (assetId: number) => {
        const existing = liveGlobalByAsset.get(assetId);
        if (existing) {
            const fees = feesFromOffer(existing);
            globalForm.setFieldValue("enabled", true);
            globalForm.setFieldValue("feeFixed", fees.feeFixed);
            globalForm.setFieldValue("feePct", fees.feePct);
            globalForm.setFieldValue("remaining", fees.remaining);
            globalForm.setFieldValue(
                "expiresAtSeconds",
                fees.expiresAtSeconds,
            );
        } else {
            globalForm.setFieldValue("enabled", false);
            globalForm.setFieldValue("feeFixed", "0");
            globalForm.setFieldValue("feePct", "0");
            globalForm.setFieldValue("remaining", "");
            globalForm.setFieldValue("expiresAtSeconds", 0);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {isSell ? "Sell-claim offer" : "Buy-claim offer"}
                    </DialogTitle>
                    <DialogDescription>
                        {isSell
                            ? `Sell claims you hold${lockedSymbol ? ` in ${lockedSymbol}` : " in this asset"}. Positive spread is your profit (1 = 1% over face); negative is a discount. Buyers hit this offer.`
                            : `Buy claims${lockedSymbol ? ` in ${lockedSymbol}` : " in this asset"} at this rate. Spread is signed: positive haircuts the seller, negative is a premium. At take the debtor must know you, and new exposure needs your credit line to them with enough capacity.`}
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
                    {prefill?.assetId === undefined ? (
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
                                />
                            )}
                        />
                    ) : null}
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
                                            labels={["Save", "Saving…"]}
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

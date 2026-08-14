import { useEffect, useMemo } from "react";

import { AssetField, ExpiresField } from "@/components/form-fields";
import { useRoutingPolicies } from "@/hooks/use-banx-data";
import {
    useRemoveGlobalRoutingPolicy,
    useRemoveRoutingPolicy,
    useSetGlobalRoutingPolicy,
    useSetRoutingPolicy,
} from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    formatRawAmount,
    formatToPrecision,
} from "@/lib/amount";
import {
    MAX_HOP_FEE_PERCENT,
    MAX_HOP_FEE_PPM,
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    amountFieldValidator,
    percentFieldValidator,
    percentStringToPpm,
    ppmToPercentInput,
    useAppForm,
} from "@/lib/form";
import type { Asset, RoutingPolicy } from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export type RoutingPolicyPrefill = {
    /** Next-hop creditor → open **override** dialog. Omit for **global**. */
    creditor?: string;
    assetId?: number;
};

type FeeFields = {
    assetId: number | undefined;
    hopFeeFixed: string;
    hopFeePct: string;
    maxAcceptPct: string;
    expiresAtSeconds: number;
};

const defaultFees = (assetId?: number): FeeFields => ({
    assetId,
    hopFeeFixed: "0",
    hopFeePct: "0",
    maxAcceptPct: "100",
    expiresAtSeconds: 0,
});

function policyLive(p: RoutingPolicy, nowSec: number): boolean {
    return p.expiresAt === 0 || p.expiresAt >= nowSec;
}

function feesFromPolicy(
    p: RoutingPolicy,
    precision: number,
): FeeFields {
    return {
        assetId: p.assetId,
        hopFeeFixed: formatRawAmount(p.feeFixed, precision).replace(/,/g, ""),
        hopFeePct: ppmToPercentInput(p.feePercentPpm),
        maxAcceptPct: ppmToPercentInput(p.maxLineAprPpm),
        expiresAtSeconds: p.expiresAt,
    };
}

function feePayload(value: FeeFields) {
    return {
        assetId: value.assetId!,
        hopFeeFixed: value.hopFeeFixed.trim(),
        hopFeePercentPpm: percentStringToPpm(value.hopFeePct, MAX_HOP_FEE_PPM),
        maxAcceptRatePpm: percentStringToPpm(value.maxAcceptPct, PPM_SCALE),
        expiresAtSeconds: value.expiresAtSeconds,
    };
}

const hopFeeValidators = {
    onChange: percentFieldValidator(MAX_HOP_FEE_PERCENT),
    onSubmit: percentFieldValidator(MAX_HOP_FEE_PERCENT),
};

const aprValidators = {
    onChange: percentFieldValidator(MAX_PERCENT),
    onSubmit: percentFieldValidator(MAX_PERCENT),
};

/** Sample path amount used in the hop-fee illustration. */
const SAMPLE_HOP_IN = 15;

/**
 * on-chain Stripe-style: `out = in * (1 - fee_pct/100) - fee_fixed`.
 * Returns null if inputs are invalid (fee ≥ 100%, fixed consumes all, etc.).
 */
function previewHopOut(
    amountIn: number,
    feeFixed: string,
    feePct: string,
): number | null {
    const fixed = Number(String(feeFixed).trim());
    const pct = Number(String(feePct).trim());
    if (!Number.isFinite(fixed) || !Number.isFinite(pct)) return null;
    if (fixed < 0 || pct < 0 || pct >= 100) return null;
    const afterPct = amountIn * (1 - pct / 100);
    if (fixed >= afterPct) return null;
    return afterPct - fixed;
}

/** Centered sample path: `10 Alice ← you → out Bob` */
function HopFeeExample({
    hopFeeFixed,
    hopFeePct,
    precision,
    intermediate,
    nextHop = "bob",
    prior = "alice",
    sampleIn = SAMPLE_HOP_IN,
}: {
    hopFeeFixed: string;
    hopFeePct: string;
    precision: number;
    intermediate: string;
    nextHop?: string;
    prior?: string;
    sampleIn?: number;
}) {
    const out = previewHopOut(sampleIn, hopFeeFixed, hopFeePct);
    const inStr =
        formatToPrecision(String(sampleIn), precision) ?? String(sampleIn);
    const outStr =
        out === null
            ? "—"
            : (formatToPrecision(
                  out.toFixed(Math.max(precision, 6)),
                  precision,
              ) ?? out.toFixed(precision));

    return (
        <p className="text-muted-foreground text-center text-xs font-mono leading-relaxed">
            <span className="text-foreground">{inStr}</span> {prior}{" "}
            <span className="opacity-50">←</span>{" "}
            <span className="text-foreground font-medium">{intermediate}</span>{" "}
            <span className="opacity-50">→</span>{" "}
            <span className="text-foreground">{outStr}</span> {nextHop}
            <span className="text-muted-foreground mt-0.5 block font-sans text-[0.7rem] normal-case tracking-normal">
                percent of amount, then fixed fee
            </span>
        </p>
    );
}

/**
 * Global routing (header) — fee form only, no account.
 * Override (row) — switch reflects whether an override exists; off + Save removes.
 */
export function RoutingPolicyDialog({
    open,
    onOpenChange,
    assets,
    prefill,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    prefill?: RoutingPolicyPrefill | null;
}) {
    const creditor = prefill?.creditor?.trim() ?? "";
    const isOverride = !!creditor;

    const { data: user } = useCurrentUser();
    const intermediate = user?.trim() || "you";

    const { data: routing = [] } = useRoutingPolicies();
    const setGlobalRouting = useSetGlobalRoutingPolicy();
    const setRouting = useSetRoutingPolicy();
    const removeGlobal = useRemoveGlobalRoutingPolicy();
    const removeOverride = useRemoveRoutingPolicy();

    const precisionOf = (id: number) =>
        assets.find((a) => a.id === id)?.precision ?? 0;

    const nowSec = Math.floor(Date.now() / 1000);

    /** Live per-creditor override for this next-hop (+ asset when known). */
    const existingOverride = useMemo(() => {
        if (!creditor) return undefined;
        const matches = routing.filter(
            (p) =>
                !p.isGlobal &&
                p.counterparty === creditor &&
                policyLive(p, nowSec) &&
                (prefill?.assetId === undefined ||
                    p.assetId === prefill.assetId),
        );
        if (prefill?.assetId !== undefined) {
            return matches.find((p) => p.assetId === prefill.assetId);
        }
        return matches[0];
    }, [routing, creditor, prefill?.assetId, nowSec]);

    /** Live global policies by asset id. */
    const liveGlobalByAsset = useMemo(() => {
        const map = new Map<number, RoutingPolicy>();
        for (const p of routing) {
            if (p.isGlobal && policyLive(p, nowSec)) {
                map.set(p.assetId, p);
            }
        }
        // note: RoutingPolicy === ClearingOffer
        return map;
    }, [routing, nowSec]);

    /** Live global for prefilled asset (if any), else first live global. */
    const existingGlobal = useMemo(() => {
        if (isOverride) return undefined;
        if (prefill?.assetId !== undefined) {
            return liveGlobalByAsset.get(prefill.assetId);
        }
        return liveGlobalByAsset.values().next().value;
    }, [isOverride, prefill?.assetId, liveGlobalByAsset]);

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
                setGlobalRouting.mutate(feePayload({ ...value, assetId }), {
                    onSuccess: () => {
                        onOpenChange(false);
                        resolve();
                    },
                    onError: (e: Error) => reject(e),
                });
            });
        },
    });

    const overrideForm = useAppForm({
        defaultValues: {
            enabled: false,
            ...defaultFees(prefill?.assetId),
        },
        onSubmit: async ({ value }) => {
            // Asset is fixed by the account row that opened this dialog.
            const assetId = prefill?.assetId;
            if (assetId === undefined) return;

            if (!value.enabled) {
                await new Promise<void>((resolve, reject) => {
                    removeOverride.mutate(
                        { creditor, assetId },
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
                setRouting.mutate(
                    { creditor, ...feePayload({ ...value, assetId }) },
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

    // Reset when opening; toggle follows whether a live override exists.
    useEffect(() => {
        if (!open) return;
        if (isOverride) {
            if (existingOverride) {
                overrideForm.reset({
                    enabled: true,
                    ...feesFromPolicy(
                        existingOverride,
                        precisionOf(existingOverride.assetId),
                    ),
                });
            } else {
                overrideForm.reset({
                    enabled: false,
                    ...defaultFees(prefill?.assetId),
                });
            }
        } else if (existingGlobal) {
            globalForm.reset({
                enabled: true,
                ...feesFromPolicy(
                    existingGlobal,
                    precisionOf(existingGlobal.assetId),
                ),
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
        isOverride,
        prefill?.assetId,
        creditor,
        existingOverride,
        existingGlobal,
    ]);

    // ── Override (opened from an account row) ─────────────────────────
    if (isOverride) {
        const pending = setRouting.isPending || removeOverride.isPending;
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Routing override</DialogTitle>
                        <DialogDescription>
                            Hop fees when you path-pay via next-hop{" "}
                            <strong>{creditor}</strong>
                            {prefill?.assetId !== undefined ? (
                                <>
                                    {" "}
                                    in{" "}
                                    <strong>
                                        {assets
                                            .find(
                                                (a) =>
                                                    a.id === prefill.assetId,
                                            )
                                            ?.symbol.toUpperCase() ??
                                            `#${prefill.assetId}`}
                                    </strong>
                                </>
                            ) : null}
                            .
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="grid gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void overrideForm.handleSubmit();
                        }}
                    >
                        <overrideForm.AppField
                            name="enabled"
                            children={(field) => (
                                <field.SwitchField
                                    label={`Override for ${creditor}`}
                                />
                            )}
                        />

                        <overrideForm.Subscribe
                            selector={(s) => s.values.enabled}
                            children={(enabled) => {
                                const assetId = prefill?.assetId;
                                const precision =
                                    assetId !== undefined
                                        ? precisionOf(assetId)
                                        : 0;
                                return enabled ? (
                                    <>
                                        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                                            <overrideForm.AppField
                                                name="hopFeeFixed"
                                                validators={{
                                                    onChange:
                                                        amountFieldValidator(
                                                            precision,
                                                            { allowZero: true },
                                                        ),
                                                    onSubmit:
                                                        amountFieldValidator(
                                                            precision,
                                                            { allowZero: true },
                                                        ),
                                                }}
                                                children={(field) => (
                                                    <field.TextField
                                                        label={
                                                            assetId !==
                                                            undefined
                                                                ? `Hop fee fixed (${amountPlaceholder(precision)})`
                                                                : "Hop fee fixed"
                                                        }
                                                        inputMode="decimal"
                                                        placeholder={amountPlaceholder(
                                                            precision,
                                                        )}
                                                    />
                                                )}
                                            />
                                            <overrideForm.AppField
                                                name="hopFeePct"
                                                validators={hopFeeValidators}
                                                children={(field) => (
                                                    <field.TextField
                                                        label="Hop fee %"
                                                        inputMode="decimal"
                                                        min={0}
                                                        max={
                                                            MAX_HOP_FEE_PERCENT
                                                        }
                                                        step={MIN_PERCENT_STEP}
                                                    />
                                                )}
                                            />
                                        </div>
                                        <overrideForm.Subscribe
                                            selector={(s) => ({
                                                hopFeeFixed:
                                                    s.values.hopFeeFixed,
                                                hopFeePct: s.values.hopFeePct,
                                            })}
                                            children={({
                                                hopFeeFixed,
                                                hopFeePct,
                                            }) => (
                                                <HopFeeExample
                                                    hopFeeFixed={hopFeeFixed}
                                                    hopFeePct={hopFeePct}
                                                    precision={precision}
                                                    intermediate={intermediate}
                                                    nextHop={creditor}
                                                />
                                            )}
                                        />
                                        <overrideForm.AppField
                                            name="maxAcceptPct"
                                            validators={aprValidators}
                                            children={(field) => (
                                                <field.TextField
                                                    label="Max accept APR %"
                                                    inputMode="decimal"
                                                    min={0}
                                                    max={MAX_PERCENT}
                                                    step={MIN_PERCENT_STEP}
                                                />
                                            )}
                                        />
                                        <overrideForm.Field
                                            name="expiresAtSeconds"
                                            children={(field) => (
                                                <ExpiresField
                                                    value={field.state.value}
                                                    onChange={(v) =>
                                                        field.handleChange(v)
                                                    }
                                                />
                                            )}
                                        />
                                    </>
                                ) : null;
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
                            <overrideForm.Subscribe
                                selector={(s) => s.values}
                                children={(values) => {
                                    const assetId = prefill?.assetId;
                                    // Off + no existing override: nothing to remove
                                    const nothingToDo =
                                        !values.enabled && !existingOverride;
                                    return (
                                        <overrideForm.AppForm>
                                            <overrideForm.SubmitButton
                                                labels={
                                                    values.enabled
                                                        ? [
                                                              existingOverride
                                                                  ? "Update override"
                                                                  : "Save override",
                                                              "Saving…",
                                                          ]
                                                        : [
                                                              "Remove override",
                                                              "Removing…",
                                                          ]
                                                }
                                                loading={pending}
                                                disabled={
                                                    assetId === undefined ||
                                                    nothingToDo
                                                }
                                            />
                                        </overrideForm.AppForm>
                                    );
                                }}
                            />
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        );
    }

    // ── Global (header) — same toggle pattern as override, no account ─
    const globalPending =
        setGlobalRouting.isPending || removeGlobal.isPending;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Global routing policy</DialogTitle>
                    <DialogDescription>
                        Default hop fees for any next hop in this asset.
                        Per-creditor overrides are set from an account row.
                        Turn off and Save to remove global routing for the
                        selected asset.
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
                    <globalForm.AppField
                        name="enabled"
                        children={(field) => (
                            <field.SwitchField label="Global routing" />
                        )}
                    />

                    <globalForm.Subscribe
                        selector={(s) => s.values.enabled}
                        children={(enabled) =>
                            enabled ? (
                                <>
                                    <globalForm.Field
                                        name="assetId"
                                        listeners={{
                                            onChange: ({ value }) => {
                                                if (value === undefined)
                                                    return;
                                                const existing =
                                                    liveGlobalByAsset.get(
                                                        value,
                                                    );
                                                if (existing) {
                                                    const fees =
                                                        feesFromPolicy(
                                                            existing,
                                                            precisionOf(
                                                                existing.assetId,
                                                            ),
                                                        );
                                                    globalForm.setFieldValue(
                                                        "hopFeeFixed",
                                                        fees.hopFeeFixed,
                                                    );
                                                    globalForm.setFieldValue(
                                                        "hopFeePct",
                                                        fees.hopFeePct,
                                                    );
                                                    globalForm.setFieldValue(
                                                        "maxAcceptPct",
                                                        fees.maxAcceptPct,
                                                    );
                                                    globalForm.setFieldValue(
                                                        "expiresAtSeconds",
                                                        fees.expiresAtSeconds,
                                                    );
                                                } else {
                                                    globalForm.setFieldValue(
                                                        "hopFeeFixed",
                                                        "0",
                                                    );
                                                    globalForm.setFieldValue(
                                                        "hopFeePct",
                                                        "0",
                                                    );
                                                    globalForm.setFieldValue(
                                                        "maxAcceptPct",
                                                        "100",
                                                    );
                                                    globalForm.setFieldValue(
                                                        "expiresAtSeconds",
                                                        0,
                                                    );
                                                }
                                            },
                                        }}
                                        children={(field) => (
                                            <AssetField
                                                assets={assets}
                                                value={field.state.value}
                                                onChange={(id) =>
                                                    field.handleChange(id)
                                                }
                                            />
                                        )}
                                    />
                                    <globalForm.Subscribe
                                        selector={(s) => s.values.assetId}
                                        children={(assetId) => {
                                            const precision =
                                                assetId !== undefined
                                                    ? precisionOf(assetId)
                                                    : 0;
                                            return (
                                                <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                                                    <globalForm.AppField
                                                        name="hopFeeFixed"
                                                        validators={{
                                                            onChange:
                                                                amountFieldValidator(
                                                                    precision,
                                                                    {
                                                                        allowZero: true,
                                                                    },
                                                                ),
                                                            onSubmit:
                                                                amountFieldValidator(
                                                                    precision,
                                                                    {
                                                                        allowZero: true,
                                                                    },
                                                                ),
                                                        }}
                                                        children={(field) => (
                                                            <field.TextField
                                                                label={
                                                                    assetId !==
                                                                    undefined
                                                                        ? `Hop fee fixed (${amountPlaceholder(precision)})`
                                                                        : "Hop fee fixed"
                                                                }
                                                                inputMode="decimal"
                                                                placeholder={amountPlaceholder(
                                                                    precision,
                                                                )}
                                                                disabled={
                                                                    assetId ===
                                                                    undefined
                                                                }
                                                            />
                                                        )}
                                                    />
                                                    <globalForm.AppField
                                                        name="hopFeePct"
                                                        validators={
                                                            hopFeeValidators
                                                        }
                                                        children={(field) => (
                                                            <field.TextField
                                                                label="Hop fee %"
                                                                inputMode="decimal"
                                                                min={0}
                                                                max={
                                                                    MAX_HOP_FEE_PERCENT
                                                                }
                                                                step={
                                                                    MIN_PERCENT_STEP
                                                                }
                                                            />
                                                        )}
                                                    />
                                                </div>
                                            );
                                        }}
                                    />
                                    <globalForm.Subscribe
                                        selector={(s) => ({
                                            hopFeeFixed: s.values.hopFeeFixed,
                                            hopFeePct: s.values.hopFeePct,
                                            assetId: s.values.assetId,
                                        })}
                                        children={({
                                            hopFeeFixed,
                                            hopFeePct,
                                            assetId,
                                        }) => (
                                            <HopFeeExample
                                                hopFeeFixed={hopFeeFixed}
                                                hopFeePct={hopFeePct}
                                                precision={
                                                    assetId !== undefined
                                                        ? precisionOf(assetId)
                                                        : 0
                                                }
                                                intermediate={intermediate}
                                                nextHop="bob"
                                            />
                                        )}
                                    />
                                    <globalForm.AppField
                                        name="maxAcceptPct"
                                        validators={aprValidators}
                                        children={(field) => (
                                            <field.TextField
                                                label="Max accept APR %"
                                                inputMode="decimal"
                                                min={0}
                                                max={MAX_PERCENT}
                                                step={MIN_PERCENT_STEP}
                                            />
                                        )}
                                    />
                                    <globalForm.Field
                                        name="expiresAtSeconds"
                                        children={(field) => (
                                            <ExpiresField
                                                value={field.state.value}
                                                onChange={(v) =>
                                                    field.handleChange(v)
                                                }
                                            />
                                        )}
                                    />
                                </>
                            ) : null
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
                                const assetId =
                                    values.assetId ?? prefill?.assetId;
                                const hasLive =
                                    assetId !== undefined &&
                                    liveGlobalByAsset.has(assetId);
                                // Off with no policy: nothing to remove
                                const nothingToDo =
                                    !values.enabled && !hasLive;
                                return (
                                    <globalForm.AppForm>
                                        <globalForm.SubmitButton
                                            labels={
                                                values.enabled
                                                    ? [
                                                          hasLive
                                                              ? "Update global routing"
                                                              : "Save global routing",
                                                          "Saving…",
                                                      ]
                                                    : [
                                                          "Remove global",
                                                          "Removing…",
                                                      ]
                                            }
                                            loading={globalPending}
                                            disabled={
                                                (values.enabled &&
                                                    assetId === undefined) ||
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

import { useEffect, useMemo } from "react";

import { AssetField, ExpiresField } from "@/components/form-fields";
import { useForwardOffers } from "@/hooks/use-banx-data";
import {
    useRemoveForwardOffer,
    useRemoveGlobalForwardOffer,
    useSetForwardOffer,
    useSetGlobalForwardOffer,
} from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    displayAmount,
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
import type { Asset, ForwardOffer } from "@/lib/graphql";

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

export type RoutingPolicyPrefill = {
    /** Next-hop creditor → open **specific** dialog. Omit for **global**. */
    creditor?: string;
    assetId?: number;
};

type FeeFields = {
    assetId: number | undefined;
    hopFeeFixed: string;
    hopFeePct: string;
    maxAcceptPct: string;
    expiresAtSeconds: number;
    allowUnknown: boolean;
};

const defaultFees = (assetId?: number): FeeFields => ({
    assetId,
    hopFeeFixed: "0",
    hopFeePct: "0",
    maxAcceptPct: "100",
    expiresAtSeconds: 0,
    allowUnknown: false,
});

function offerLive(p: ForwardOffer, nowSec: number): boolean {
    return p.expiresAt === 0 || p.expiresAt >= nowSec;
}

function feesFromOffer(p: ForwardOffer): FeeFields {
    return {
        assetId: p.assetId,
        hopFeeFixed: displayAmount(p.feeFixed),
        hopFeePct: ppmToPercentInput(p.feePercentPpm),
        maxAcceptPct: ppmToPercentInput(p.maxLineAprPpm),
        expiresAtSeconds: p.expiresAt,
        allowUnknown: p.allowUnknown,
    };
}

function feePayload(value: FeeFields) {
    return {
        assetId: value.assetId!,
        feeFixed: value.hopFeeFixed.trim(),
        feePercentPpm: percentStringToPpm(value.hopFeePct, MAX_HOP_FEE_PPM),
        maxLineAprPpm: percentStringToPpm(value.maxAcceptPct, PPM_SCALE),
        expiresAtSeconds: value.expiresAtSeconds,
        allowUnknown: value.allowUnknown,
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

const SAMPLE_HOP_IN = 15;

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
 * Path-forward offer. Global (header) or specific next hop (account row).
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
    const nextHop = prefill?.creditor?.trim() ?? "";
    const isSpecific = !!nextHop;

    const { data: user } = useCurrentUser();
    const intermediate = user?.trim() || "you";

    const { data: offers = [] } = useForwardOffers();
    const setGlobal = useSetGlobalForwardOffer();
    const setSpecific = useSetForwardOffer();
    const removeGlobal = useRemoveGlobalForwardOffer();
    const removeSpecific = useRemoveForwardOffer();

    const precisionOf = (id: number) =>
        assets.find((a) => a.id === id)?.precision ?? 0;

    const nowSec = Math.floor(Date.now() / 1000);

    const existingSpecific = useMemo(() => {
        if (!nextHop) return undefined;
        const matches = offers.filter(
            (p) =>
                !p.isGlobal &&
                p.nextHop === nextHop &&
                offerLive(p, nowSec) &&
                (prefill?.assetId === undefined ||
                    p.assetId === prefill.assetId),
        );
        if (prefill?.assetId !== undefined) {
            return matches.find((p) => p.assetId === prefill.assetId);
        }
        return matches[0];
    }, [offers, nextHop, prefill?.assetId, nowSec]);

    const liveGlobalByAsset = useMemo(() => {
        const map = new Map<number, ForwardOffer>();
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
                setGlobal.mutate(feePayload({ ...value, assetId }), {
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
            const assetId = prefill?.assetId;
            if (assetId === undefined) return;

            if (!value.enabled) {
                await new Promise<void>((resolve, reject) => {
                    removeSpecific.mutate(
                        { nextHop, assetId },
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
                    { nextHop, ...feePayload({ ...value, assetId }) },
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
        nextHop,
        existingSpecific,
        existingGlobal,
    ]);

    if (isSpecific) {
        const pending = setSpecific.isPending || removeSpecific.isPending;
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Path-forward offer</DialogTitle>
                        <DialogDescription>
                            Let others path-pay through you to{" "}
                            <strong>{nextHop}</strong>
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
                            . Hop fees apply; max line APR rejects a next hop
                            whose line is more expensive than you accept.
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
                                    label={`Offer for ${nextHop}`}
                                />
                            )}
                        />

                        <specificForm.Subscribe
                            selector={(s) => s.values.enabled}
                            children={(enabled) => {
                                const assetId = prefill?.assetId;
                                const precision =
                                    assetId !== undefined
                                        ? precisionOf(assetId)
                                        : 0;
                                const locked = !enabled;
                                return (
                                    <div
                                        className={cn(
                                            "grid gap-5 transition-opacity duration-200",
                                            locked && "opacity-40",
                                        )}
                                    >
                                        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                                            <specificForm.AppField
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
                                                                ? `Fee fixed (${amountPlaceholder(precision)})`
                                                                : "Fee fixed"
                                                        }
                                                        inputMode="decimal"
                                                        placeholder={amountPlaceholder(
                                                            precision,
                                                        )}
                                                        disabled={locked}
                                                    />
                                                )}
                                            />
                                            <specificForm.AppField
                                                name="hopFeePct"
                                                validators={hopFeeValidators}
                                                children={(field) => (
                                                    <field.TextField
                                                        label="Fee %"
                                                        inputMode="decimal"
                                                        min={0}
                                                        max={
                                                            MAX_HOP_FEE_PERCENT
                                                        }
                                                        step={MIN_PERCENT_STEP}
                                                        disabled={locked}
                                                    />
                                                )}
                                            />
                                        </div>
                                        <specificForm.Subscribe
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
                                                    nextHop={nextHop}
                                                />
                                            )}
                                        />
                                        <specificForm.Field
                                            name="expiresAtSeconds"
                                            children={(field) => (
                                                <ExpiresField
                                                    value={field.state.value}
                                                    onChange={(v) =>
                                                        field.handleChange(v)
                                                    }
                                                    disabled={locked}
                                                />
                                            )}
                                        />
                                        <specificForm.AppField
                                            name="maxAcceptPct"
                                            validators={aprValidators}
                                            children={(field) => (
                                                <field.TextField
                                                    label="Max line APR %"
                                                    inputMode="decimal"
                                                    min={0}
                                                    max={MAX_PERCENT}
                                                    step={MIN_PERCENT_STEP}
                                                    disabled={locked}
                                                />
                                            )}
                                        />
                                        <specificForm.AppField
                                            name="allowUnknown"
                                            children={(field) => (
                                                <field.SwitchField
                                                    label="Allow unknown next hop"
                                                    description="If off, you must already have a credit line to them (limit 0 is enough). If on, they can become your creditor without that line."
                                                    disabled={locked}
                                                />
                                            )}
                                        />
                                    </div>
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
                                    const assetId = prefill?.assetId;
                                    const nothingToDo =
                                        !values.enabled && !existingSpecific;
                                    return (
                                        <specificForm.AppForm>
                                            <specificForm.SubmitButton
                                                labels={["Save", "Saving…"]}
                                                loading={pending}
                                                disabled={
                                                    assetId === undefined ||
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
            globalForm.setFieldValue("hopFeeFixed", fees.hopFeeFixed);
            globalForm.setFieldValue("hopFeePct", fees.hopFeePct);
            globalForm.setFieldValue("maxAcceptPct", fees.maxAcceptPct);
            globalForm.setFieldValue(
                "expiresAtSeconds",
                fees.expiresAtSeconds,
            );
            globalForm.setFieldValue("allowUnknown", fees.allowUnknown);
        } else {
            globalForm.setFieldValue("enabled", false);
            globalForm.setFieldValue("hopFeeFixed", "0");
            globalForm.setFieldValue("hopFeePct", "0");
            globalForm.setFieldValue("maxAcceptPct", "100");
            globalForm.setFieldValue("expiresAtSeconds", 0);
            globalForm.setFieldValue("allowUnknown", false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Path-forward offer</DialogTitle>
                    <DialogDescription>
                        Sit in the middle of a path pay for this asset. The
                        next creditor must have lined you (or you already owe
                        them). Closed by default: you must have lined them too
                        (limit 0 is enough). Turn on allow-unknown to skip
                        that. This does not buy claims — post a buy-claim
                        offer for that.
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
                    <globalForm.Subscribe
                        selector={(s) => s.values.enabled}
                        children={(enabled) => (
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
                                        onChange={(id) =>
                                            field.handleChange(id)
                                        }
                                        itemActive={(a) =>
                                            liveGlobalByAsset.has(a.id)
                                        }
                                        selectedActive={enabled}
                                    />
                                )}
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
                        selector={(s) => ({
                            enabled: s.values.enabled,
                            assetId: s.values.assetId,
                        })}
                        children={({ enabled, assetId }) => {
                            const precision =
                                assetId !== undefined
                                    ? precisionOf(assetId)
                                    : 0;
                            const locked = !enabled || assetId === undefined;
                            return (
                                <div
                                    className={cn(
                                        "grid gap-5 transition-opacity duration-200",
                                        locked && "opacity-40",
                                    )}
                                >
                                    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                                        <globalForm.AppField
                                            name="hopFeeFixed"
                                            validators={{
                                                onChange: amountFieldValidator(
                                                    precision,
                                                    { allowZero: true },
                                                ),
                                                onSubmit: amountFieldValidator(
                                                    precision,
                                                    { allowZero: true },
                                                ),
                                            }}
                                            children={(field) => (
                                                <field.TextField
                                                    label={
                                                        assetId !== undefined
                                                            ? `Fee fixed (${amountPlaceholder(precision)})`
                                                            : "Fee fixed"
                                                    }
                                                    inputMode="decimal"
                                                    placeholder={amountPlaceholder(
                                                        precision,
                                                    )}
                                                    disabled={locked}
                                                />
                                            )}
                                        />
                                        <globalForm.AppField
                                            name="hopFeePct"
                                            validators={hopFeeValidators}
                                            children={(field) => (
                                                <field.TextField
                                                    label="Fee %"
                                                    inputMode="decimal"
                                                    min={0}
                                                    max={MAX_HOP_FEE_PERCENT}
                                                    step={MIN_PERCENT_STEP}
                                                    disabled={locked}
                                                />
                                            )}
                                        />
                                    </div>
                                    <globalForm.Subscribe
                                        selector={(s) => ({
                                            hopFeeFixed: s.values.hopFeeFixed,
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
                                                nextHop="bob"
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
                                                disabled={locked}
                                            />
                                        )}
                                    />
                                    <globalForm.AppField
                                        name="maxAcceptPct"
                                        validators={aprValidators}
                                        children={(field) => (
                                            <field.TextField
                                                label="Max line APR %"
                                                inputMode="decimal"
                                                min={0}
                                                max={MAX_PERCENT}
                                                step={MIN_PERCENT_STEP}
                                                disabled={locked}
                                            />
                                        )}
                                    />
                                    <globalForm.AppField
                                        name="allowUnknown"
                                        children={(field) => (
                                            <field.SwitchField
                                                label="Allow unknown next hop"
                                                description="If off, you must already have a credit line to the next person (limit 0 is enough). If on, anyone who lined you can become your creditor."
                                                disabled={locked}
                                            />
                                        )}
                                    />
                                </div>
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

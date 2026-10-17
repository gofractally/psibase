import { useEffect } from "react";

import { AssetField } from "@/components/form-fields";
import {
    useConvert,
    useRemoveCurrencyPolicy,
    useSetCurrencyPolicy,
} from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    applyQuotedRate,
    formatFxToRate,
    formatRawAmount,
    humanToRaw,
} from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";
import { amountFieldValidator, useAppForm } from "@/lib/form";
import type { Asset, CurrencyPolicy } from "@/lib/graphql";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

/** Live quotes for one debt direction, with budget left. */
export function liveFromPolicies(
    policies: CurrencyPolicy[],
    fromAsset: number,
    fromPrecision: number,
    nowSec: number,
    posterIsCreditor: boolean,
): CurrencyPolicy[] {
    return policies.filter(
        (p) =>
            p.fromAsset === fromAsset &&
            p.posterIsCreditor === posterIsCreditor &&
            (p.expiresAt === 0 || p.expiresAt >= nowSec) &&
            humanToRaw(p.remaining || "0", fromPrecision) > 0n,
    );
}

export function quoteSummary(
    policy: CurrencyPolicy,
    fromSymbol: string,
    fromPrecision: number,
    toSymbol: string,
    toPrecision: number,
): string {
    const rate = formatFxToRate(policy.fxRate, fromPrecision, toPrecision);
    const left = formatRawAmount(policy.remaining, fromPrecision);
    const fee = humanToRaw(policy.feeFixed || "0", fromPrecision);
    const feeAmount = formatRawAmount(policy.feeFixed, fromPrecision);
    const feeText =
        fee > 0n
            ? policy.posterIsCreditor
                ? `, fee ${feeAmount} ${fromSymbol} added`
                : `, fee ${feeAmount} ${fromSymbol} comes off`
            : "";
    return `${rate} ${toSymbol} per 1 ${fromSymbol}${feeText}, ${left} ${fromSymbol} left`;
}

function policyFor(
    policies: CurrencyPolicy[],
    fromAsset: number,
    toAsset: number | undefined,
    posterIsCreditor = false,
): CurrencyPolicy | undefined {
    if (toAsset === undefined) return undefined;
    return policies.find(
        (p) =>
            p.fromAsset === fromAsset &&
            p.toAsset === toAsset &&
            p.posterIsCreditor === posterIsCreditor,
    );
}

function takeCapRaw(
    claimRaw: string,
    policy: CurrencyPolicy,
    fromPrecision: number,
): bigint {
    const claim = BigInt(claimRaw || "0");
    const left = humanToRaw(policy.remaining || "0", fromPrecision);
    return claim < left ? claim : left;
}

/**
 * Debtor posts the from→to quote. Remaining starts as this claim and is
 * the budget for every taker, not only this counterparty.
 */
export function OfferRepayDialog({
    open,
    onOpenChange,
    counterparty,
    fromAsset,
    fromSymbol,
    fromPrecision,
    owedRaw,
    assets,
    precisionOf,
    policies,
    editPolicy,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    counterparty: string;
    fromAsset: number;
    fromSymbol: string;
    fromPrecision: number;
    /** Raw units of what you owe them in `fromAsset`. */
    owedRaw: string;
    assets: Asset[];
    precisionOf: (id: number) => number;
    /** Quotes you have already posted. */
    policies: CurrencyPolicy[];
    /** Existing pair to change. The to-asset stays put. */
    editPolicy?: CurrencyPolicy | null;
}) {
    const post = useSetCurrencyPolicy();
    const remove = useRemoveCurrencyPolicy();
    const owedHuman = formatRawAmount(owedRaw, fromPrecision);
    const otherAssets = assets.filter((a) => a.id !== fromAsset);

    const form = useAppForm({
        defaultValues: {
            toAsset: undefined as number | undefined,
            toRate: "",
            remaining: owedHuman,
        },
        onSubmit: async ({ value }) => {
            if (value.toAsset === undefined) return;
            await new Promise<void>((resolve, reject) => {
                post.mutate(
                    {
                        fromAsset,
                        toAsset: value.toAsset!,
                        posterIsCreditor: false,
                        feeFixed: editPolicy?.feeFixed ?? "0",
                        toRate: value.toRate.trim(),
                        toInterestRatePpm: editPolicy?.toInterestRatePpm ?? 0,
                        remaining: value.remaining.trim(),
                        expiresAtSeconds: editPolicy?.expiresAt ?? 0,
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
        if (editPolicy && editPolicy.fromAsset === fromAsset) {
            form.reset({
                toAsset: editPolicy.toAsset,
                toRate: formatFxToRate(
                    editPolicy.fxRate,
                    fromPrecision,
                    precisionOf(editPolicy.toAsset),
                ),
                remaining: formatRawAmount(editPolicy.remaining, fromPrecision),
            });
            return;
        }
        form.reset({
            toAsset: undefined,
            toRate: "",
            remaining: owedHuman,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        open,
        fromAsset,
        owedHuman,
        counterparty,
        editPolicy?.toAsset,
        editPolicy?.fxRate,
        editPolicy?.remaining,
    ]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {editPolicy
                            ? "Edit convert offer"
                            : "Offer to repay in another asset"}
                    </DialogTitle>
                    <DialogDescription>
                        {editPolicy
                            ? `Change the rate or budget for this pair. The budget is still the cap for everyone who holds ${fromSymbol} on you.`
                            : `${counterparty} can turn what you owe them in ${fromSymbol} into the asset you pick, at your rate. Remaining starts at this claim and is the cap for everyone who holds ${fromSymbol} on you. Posting replaces the rate you already have for debt you owe.`}
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
                    <p className="text-muted-foreground text-sm">
                        You owe{" "}
                        <span className="text-foreground font-mono tabular-nums">
                            {owedHuman} {fromSymbol}
                        </span>
                    </p>
                    <form.Field
                        name="toAsset"
                        children={(field) => (
                            <AssetField
                                label="They receive"
                                assets={otherAssets}
                                value={field.state.value}
                                disabled={!!editPolicy}
                                onChange={(id) => {
                                    field.handleChange(id);
                                    const current = String(
                                        form.state.values.toRate ?? "",
                                    ).trim();
                                    if (current) return;
                                    const existing = policyFor(
                                        policies,
                                        fromAsset,
                                        id,
                                    );
                                    if (!existing) return;
                                    form.setFieldValue(
                                        "toRate",
                                        formatFxToRate(
                                            existing.fxRate,
                                            fromPrecision,
                                            precisionOf(id),
                                        ),
                                    );
                                }}
                            />
                        )}
                    />
                    <form.Subscribe
                        selector={(s) => s.values.toAsset}
                        children={(toAsset) => {
                            if (toAsset === undefined) return null;
                            const toSymbol =
                                assets.find((a) => a.id === toAsset)?.symbol ??
                                "to";
                            const toPrecision = precisionOf(toAsset);
                            const existing = policyFor(
                                policies,
                                fromAsset,
                                toAsset,
                            );
                            return (
                                <>
                                    <form.AppField
                                        name="toRate"
                                        validators={{
                                            onChange: amountFieldValidator(
                                                toPrecision,
                                                { allowZero: false },
                                            ),
                                            onSubmit: amountFieldValidator(
                                                toPrecision,
                                                { allowZero: false },
                                            ),
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label={`${toSymbol} per 1 ${fromSymbol}`}
                                                inputMode="decimal"
                                                required
                                                placeholder={amountPlaceholder(
                                                    toPrecision,
                                                )}
                                            />
                                        )}
                                    />
                                    {existing ? (
                                        <p className="text-muted-foreground text-xs">
                                            You already accept{" "}
                                            {formatRawAmount(
                                                existing.remaining,
                                                fromPrecision,
                                            )}{" "}
                                            {fromSymbol} of debt you owe. Posting
                                            replaces that budget.
                                        </p>
                                    ) : null}
                                </>
                            );
                        }}
                    />
                    <form.AppField
                        name="remaining"
                        validators={{
                            onChange: amountFieldValidator(fromPrecision, {
                                allowZero: false,
                            }),
                            onSubmit: amountFieldValidator(fromPrecision, {
                                allowZero: false,
                            }),
                        }}
                        children={(field) => (
                            <field.TextField
                                label={`Budget (${fromSymbol})`}
                                inputMode="decimal"
                                required
                                placeholder={amountPlaceholder(fromPrecision)}
                            />
                        )}
                    />
                    <DialogFooter>
                        {editPolicy ? (
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={remove.isPending || post.isPending}
                                onClick={() =>
                                    remove.mutate(
                                        {
                                            fromAsset,
                                            toAsset: editPolicy.toAsset,
                                            posterIsCreditor: false,
                                        },
                                        {
                                            onSuccess: () =>
                                                onOpenChange(false),
                                        },
                                    )
                                }
                            >
                                {remove.isPending
                                    ? "Deleting…"
                                    : "Delete offer"}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <form.Subscribe
                            selector={(s) => s.values.toAsset}
                            children={(toAsset) => (
                                <form.AppForm>
                                    <form.SubmitButton
                                        labels={
                                            editPolicy
                                                ? ["Save offer", "Saving…"]
                                                : ["Post offer", "Posting…"]
                                        }
                                        loading={post.isPending}
                                        disabled={
                                            toAsset === undefined ||
                                            toAsset === fromAsset ||
                                            remove.isPending
                                        }
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

/**
 * Creditor takes the debtor's posted quote. Amount is capped at the
 * smaller of the claim and their remaining budget.
 */
export function TakeConvertDialog({
    open,
    onOpenChange,
    counterparty,
    counterpartyLabel,
    fromAsset,
    fromSymbol,
    fromPrecision,
    claimRaw,
    policies,
    assets,
    precisionOf,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Chain account the convert action names. */
    counterparty: string;
    /** Shown name. Falls back to `counterparty`. */
    counterpartyLabel?: string;
    fromAsset: number;
    fromSymbol: string;
    fromPrecision: number;
    /** Raw units they owe you in `fromAsset`. */
    claimRaw: string;
    policies: CurrencyPolicy[];
    assets: Asset[];
    precisionOf: (id: number) => number;
}) {
    const convert = useConvert();
    const toChoices = assets.filter((a) =>
        policies.some((p) => p.toAsset === a.id),
    );
    const firstTo = policies[0]?.toAsset;

    const form = useAppForm({
        defaultValues: {
            toAsset: undefined as number | undefined,
            amount: "",
        },
        onSubmit: async ({ value }) => {
            const policy = policyFor(policies, fromAsset, value.toAsset);
            if (!policy || value.toAsset === undefined) return;
            const expected = applyQuotedRate(
                value.amount.trim(),
                policy.feeFixed,
                policy.fxRate,
                fromPrecision,
                precisionOf(policy.toAsset),
                policy.posterIsCreditor,
            );
            if (!expected) return;
            await new Promise<void>((resolve, reject) => {
                convert.mutate(
                    {
                        counterparty,
                        fromAsset,
                        toAsset: value.toAsset!,
                        amountFrom: value.amount.trim(),
                        minTo: expected,
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
        if (!open || firstTo === undefined) return;
        const policy = policyFor(policies, fromAsset, firstTo);
        if (!policy) return;
        form.reset({
            toAsset: firstTo,
            amount: formatRawAmount(
                takeCapRaw(claimRaw, policy, fromPrecision).toString(),
                fromPrecision,
            ),
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, fromAsset, claimRaw, firstTo, counterparty]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Convert this claim</DialogTitle>
                    <DialogDescription>
                        Take {counterpartyLabel ?? counterparty}&apos;s quote.
                        This rebooks the {fromSymbol} they owe you into the
                        asset they priced. The rate is theirs.
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
                    {toChoices.length > 1 ? (
                        <form.Field
                            name="toAsset"
                            children={(field) => (
                                <AssetField
                                    label="You receive"
                                    assets={toChoices}
                                    value={field.state.value}
                                    onChange={(id) => {
                                        field.handleChange(id);
                                        const policy = policyFor(
                                            policies,
                                            fromAsset,
                                            id,
                                        );
                                        if (!policy) return;
                                        const current = String(
                                            form.state.values.amount ?? "",
                                        );
                                        const previous = policyFor(
                                            policies,
                                            fromAsset,
                                            field.state.value,
                                        );
                                        const previousDefault = previous
                                            ? formatRawAmount(
                                                  takeCapRaw(
                                                      claimRaw,
                                                      previous,
                                                      fromPrecision,
                                                  ).toString(),
                                                  fromPrecision,
                                              )
                                            : "";
                                        if (
                                            current.trim() &&
                                            current.trim() !== previousDefault
                                        ) {
                                            return;
                                        }
                                        form.setFieldValue(
                                            "amount",
                                            formatRawAmount(
                                                takeCapRaw(
                                                    claimRaw,
                                                    policy,
                                                    fromPrecision,
                                                ).toString(),
                                                fromPrecision,
                                            ),
                                        );
                                    }}
                                />
                            )}
                        />
                    ) : null}
                    <form.Subscribe
                        selector={(s) => ({
                            toAsset: s.values.toAsset,
                            amount: s.values.amount,
                        })}
                        children={({ toAsset, amount }) => {
                            const policy = policyFor(
                                policies,
                                fromAsset,
                                toAsset,
                            );
                            if (!policy) return null;
                            const toSymbol =
                                assets.find((a) => a.id === policy.toAsset)
                                    ?.symbol ?? "to";
                            const toPrecision = precisionOf(policy.toAsset);
                            const cap = takeCapRaw(
                                claimRaw,
                                policy,
                                fromPrecision,
                            );
                            const capHuman = formatRawAmount(
                                cap.toString(),
                                fromPrecision,
                            );
                            const expected = applyQuotedRate(
                                String(amount ?? ""),
                                policy.feeFixed,
                                policy.fxRate,
                                fromPrecision,
                                toPrecision,
                                policy.posterIsCreditor,
                            );
                            return (
                                <>
                                    <p className="text-muted-foreground text-sm">
                                        {quoteSummary(
                                            policy,
                                            fromSymbol,
                                            fromPrecision,
                                            toSymbol,
                                            toPrecision,
                                        )}
                                        .
                                        {policy.toInterestRatePpm > 0
                                            ? ` New ${toSymbol} debt at ${ppmToPercent(policy.toInterestRatePpm)} APR.`
                                            : ""}
                                    </p>
                                    <form.AppField
                                        name="amount"
                                        validators={{
                                            onChange: ({ value }) => {
                                                const base =
                                                    amountFieldValidator(
                                                        fromPrecision,
                                                        { allowZero: false },
                                                    )({ value });
                                                if (base) return base;
                                                const raw = humanToRaw(
                                                    String(value),
                                                    fromPrecision,
                                                );
                                                if (raw > cap) {
                                                    return `Cannot exceed ${capHuman} ${fromSymbol}`;
                                                }
                                                return undefined;
                                            },
                                            onSubmit: ({ value }) => {
                                                const base =
                                                    amountFieldValidator(
                                                        fromPrecision,
                                                        { allowZero: false },
                                                    )({ value });
                                                if (base) return base;
                                                const raw = humanToRaw(
                                                    String(value),
                                                    fromPrecision,
                                                );
                                                if (raw > cap) {
                                                    return `Cannot exceed ${capHuman} ${fromSymbol}`;
                                                }
                                                if (
                                                    !applyQuotedRate(
                                                        String(value),
                                                        policy.feeFixed,
                                                        policy.fxRate,
                                                        fromPrecision,
                                                        toPrecision,
                                                        policy.posterIsCreditor,
                                                    )
                                                ) {
                                                    return "That amount is too small at their rate";
                                                }
                                                return undefined;
                                            },
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label={`Amount (${fromSymbol})`}
                                                inputMode="decimal"
                                                required
                                                placeholder={amountPlaceholder(
                                                    fromPrecision,
                                                )}
                                            />
                                        )}
                                    />
                                    <p className="text-muted-foreground text-sm">
                                        You will be owed{" "}
                                        <span className="text-foreground font-mono tabular-nums">
                                            {expected ?? "—"} {toSymbol}
                                        </span>
                                    </p>
                                </>
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
                        <form.Subscribe
                            selector={(s) => s.values.toAsset}
                            children={(toAsset) => (
                                <form.AppForm>
                                    <form.SubmitButton
                                        labels={["Convert", "Converting…"]}
                                        loading={convert.isPending}
                                        disabled={toAsset === undefined}
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

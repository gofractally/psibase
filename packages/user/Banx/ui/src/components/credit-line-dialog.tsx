import { useEffect } from "react";

import { AssetField, GracePeriodField } from "@/components/form-fields";
import { useForwardOffers } from "@/hooks/use-banx-data";
import {
    useRemoveCreditLine,
    useSetCreditLine,
    useSetGlobalForwardOffer,
} from "@/hooks/use-banx-mutations";
import { liveGlobalForward } from "@/lib/account-groups";
import { formatRawAmount } from "@/lib/amount";
import {
    DEFAULT_GRACE_SECONDS,
    daysToGraceSeconds,
    graceSecondsToPreset,
    ppmToPercentInput,
    type GracePreset,
} from "@/lib/constants";
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
import type { Asset, CreditLine } from "@/lib/graphql";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";

export function CreditLineDialog({
    open,
    onOpenChange,
    assets,
    precisionOf,
    editing,
    prefillDebtor,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    precisionOf: (id: number) => number;
    /** When set, update this line (debtor + asset fixed). */
    editing: CreditLine | null;
    /** Prefill debtor when creating a new line. */
    prefillDebtor?: string;
}) {
    const setLine = useSetCreditLine();
    const removeLine = useRemoveCreditLine();
    const setForward = useSetGlobalForwardOffer();
    const { data: forwardOffers = [] } = useForwardOffers();
    const nowSec = Math.floor(Date.now() / 1000);
    const isEdit = !!editing;

    const form = useAppForm({
        defaultValues: {
            debtor: "",
            assetId: undefined as number | undefined,
            limit: "100",
            interestPct: "0",
            deplete: false,
            gracePreset: "7" as GracePreset,
            graceDays: "7",
            allowForward: true,
        },
        onSubmit: async ({ value }) => {
            const debtor = isEdit ? editing!.debtor : value.debtor.trim();
            const assetId = isEdit ? editing!.assetId : value.assetId;
            if (assetId === undefined || !debtor) return;
            await setLine.mutateAsync({
                debtor,
                assetId,
                limit: value.limit.trim(),
                depleteOnDebit: value.deplete,
                interestRatePpm: percentStringToPpm(
                    value.interestPct,
                    PPM_SCALE,
                ),
                graceSeconds:
                    value.gracePreset === "none"
                        ? 0
                        : daysToGraceSeconds(
                              value.gracePreset === "custom"
                                  ? Number(value.graceDays.trim())
                                  : Number(value.gracePreset),
                          ),
            });
            if (
                value.allowForward &&
                !liveGlobalForward(forwardOffers, assetId, nowSec)
            ) {
                await setForward.mutateAsync({
                    assetId,
                    feeFixed: "0",
                    feePercentPpm: 0,
                    maxLineAprPpm: 0,
                    expiresAtSeconds: 0,
                    allowUnknown: false,
                });
            }
            onOpenChange(false);
        },
    });

    useEffect(() => {
        if (!open) return;
        if (editing) {
            const grace = graceSecondsToPreset(
                editing.graceSeconds ?? DEFAULT_GRACE_SECONDS,
            );
            form.reset({
                debtor: editing.debtor,
                assetId: editing.assetId,
                limit: formatRawAmount(
                    editing.limit,
                    precisionOf(editing.assetId),
                ).replace(/,/g, ""),
                interestPct: ppmToPercentInput(editing.interestRatePpm),
                deplete: editing.depleteOnDebit,
                gracePreset: grace.preset,
                graceDays: grace.days,
                allowForward: !liveGlobalForward(
                    forwardOffers,
                    editing.assetId,
                    nowSec,
                ),
            });
        } else {
            form.reset({
                debtor: prefillDebtor ?? "",
                assetId: undefined,
                limit: "100",
                interestPct: "0",
                deplete: false,
                gracePreset: "7",
                graceDays: "7",
                allowForward: true,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, editing, precisionOf, prefillDebtor]);

    const editSymbol =
        isEdit && editing
            ? (assets.find((a) => a.id === editing.assetId)?.symbol.toUpperCase() ??
              `#${editing.assetId}`)
            : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {isEdit
                            ? `Edit credit line · ${editing!.debtor} · ${editSymbol}`
                            : "Offer a credit line"}
                    </DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? `Update limit, interest, or revolving terms for ${editing!.debtor} in ${editSymbol}. A zero limit still keeps them as a known counterparty (needed if they may hold a claim on you). Remove the line to drop that.`
                            : "You are the creditor. Set how much the debtor may draw (and hold outstanding) against you. Drawn amounts show up here as savings-style claims. A zero limit is still a line — they are on your book."}
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
                    {!isEdit ? (
                        <>
                            <form.AppField
                                name="debtor"
                                validators={existingAccountValidators()}
                                children={(field) => (
                                    <field.TextField
                                        label="Debtor account"
                                        placeholder="alice"
                                        required
                                    />
                                )}
                            />
                            <form.Field
                                name="assetId"
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
                        </>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                        <form.Subscribe
                            selector={(s) => s.values.assetId}
                            children={(assetId) => {
                                const aid = isEdit
                                    ? editing!.assetId
                                    : assetId;
                                return (
                                    <form.AppField
                                        name="limit"
                                        validators={
                                            aid !== undefined
                                                ? {
                                                      onChange:
                                                          amountFieldValidator(
                                                              precisionOf(aid),
                                                              {
                                                                  allowZero: true,
                                                              },
                                                          ),
                                                      onSubmit:
                                                          amountFieldValidator(
                                                              precisionOf(aid),
                                                              {
                                                                  allowZero: true,
                                                              },
                                                          ),
                                                  }
                                                : undefined
                                        }
                                        children={(field) => (
                                            <field.TextField
                                                label="Limit"
                                                inputMode="decimal"
                                                required
                                            />
                                        )}
                                    />
                                );
                            }}
                        />
                        <form.AppField
                            name="interestPct"
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
                    <form.Subscribe
                        selector={(s) => ({
                            preset: s.values.gracePreset,
                            days: s.values.graceDays,
                        })}
                        children={({ preset, days }) => (
                            <GracePeriodField
                                preset={preset}
                                days={days}
                                onPresetChange={(p) => {
                                    form.setFieldValue("gracePreset", p);
                                    if (p === "none") {
                                        form.setFieldValue("graceDays", "0");
                                    } else if (p !== "custom") {
                                        form.setFieldValue("graceDays", p);
                                    }
                                }}
                                onDaysChange={(d) =>
                                    form.setFieldValue("graceDays", d)
                                }
                            />
                        )}
                    />
                    <p className="text-muted-foreground -mt-2 text-xs">
                        If they repay this pair to zero within this window, no
                        interest. Default is 7 days. Custom is whole days (0 =
                        interest from the first second).{" "}
                        {isEdit && editing && editing.cycleStartedAt
                            ? "An open cycle keeps its snapshotted window; this value applies to the next cycle."
                            : null}
                    </p>
                    <form.AppField
                        name="deplete"
                        children={(field) => (
                            <field.CheckboxField label="Deplete limit on each draw (non-revolving)" />
                        )}
                    />
                    <form.Subscribe
                        selector={(s) =>
                            isEdit ? editing!.assetId : s.values.assetId
                        }
                        children={(assetId) => {
                            const already = liveGlobalForward(
                                forwardOffers,
                                assetId,
                                nowSec,
                            );
                            if (already) {
                                return (
                                    <p className="text-muted-foreground text-xs">
                                        Path-forward is already on for this
                                        asset — friends can pay through you.
                                    </p>
                                );
                            }
                            return (
                                <form.AppField
                                    name="allowForward"
                                    children={(field) => (
                                        <field.CheckboxField label="Let friends path-pay through you in this asset (closed, 0% fee, 0% max APR)" />
                                    )}
                                />
                            );
                        }}
                    />
                    {isEdit && editing ? (
                        <p className="text-muted-foreground text-xs">
                            Current line exposure:{" "}
                            <span className="text-foreground font-mono tabular-nums">
                                {formatRawAmount(
                                    editing.exposure,
                                    precisionOf(editing.assetId),
                                )}
                            </span>
                            {editing.depleteOnDebit ? (
                                <>
                                    . Remaining:{" "}
                                    <span className="text-foreground font-mono tabular-nums">
                                        {formatRawAmount(
                                            editing.remaining,
                                            precisionOf(editing.assetId),
                                        )}
                                    </span>{" "}
                                    (repay does not restore it)
                                </>
                            ) : (
                                ". Limit should stay ≥ exposure for revolving lines."
                            )}
                        </p>
                    ) : null}
                    <DialogFooter>
                        {isEdit ? (
                            <Button
                                type="button"
                                variant="destructive"
                                disabled={removeLine.isPending}
                                onClick={() => {
                                    removeLine.mutate(
                                        {
                                            debtor: editing!.debtor,
                                            assetId: editing!.assetId,
                                        },
                                        {
                                            onSuccess: () =>
                                                onOpenChange(false),
                                        },
                                    );
                                }}
                            >
                                {removeLine.isPending
                                    ? "Removing…"
                                    : "Remove line"}
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
                            selector={(s) => s.values}
                            children={(values) => {
                                const assetId = isEdit
                                    ? editing!.assetId
                                    : values.assetId;
                                const debtorOk = isEdit
                                    ? true
                                    : !!values.debtor.trim();
                                return (
                                    <form.AppForm>
                                        <form.SubmitButton
                                            labels={
                                                isEdit
                                                    ? [
                                                          "Update credit line",
                                                          "Saving…",
                                                      ]
                                                    : [
                                                          "Save credit line",
                                                          "Saving…",
                                                      ]
                                            }
                                            loading={
                                                setLine.isPending ||
                                                setForward.isPending
                                            }
                                            disabled={
                                                assetId === undefined ||
                                                !debtorOk
                                            }
                                        />
                                    </form.AppForm>
                                );
                            }}
                        />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

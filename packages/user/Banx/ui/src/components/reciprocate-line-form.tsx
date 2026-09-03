import { useEffect } from "react";
import { Handshake } from "lucide-react";

import { GracePeriodField } from "@/components/form-fields";
import { useAssetMap } from "@/hooks/use-assets";
import { useSetBookAuth, useSetCreditLine } from "@/hooks/use-banx-mutations";
import { displayAmount } from "@/lib/amount";
import {
    daysToGraceSeconds,
    formatGracePeriod,
    graceSecondsToPreset,
    ppmToPercent,
    ppmToPercentInput,
    type GracePreset,
} from "@/lib/constants";
import {
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    amountFieldValidator,
    percentFieldValidator,
    percentStringToPpm,
    useAppForm,
} from "@/lib/form";
import type { PendingReciprocal } from "@/lib/invite";

import { Button } from "@shared/shadcn/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@shared/shadcn/ui/card";

export function ReciprocateLineForm({
    terms,
    onDone,
}: {
    terms: PendingReciprocal;
    onDone: () => void;
}) {
    const { symbolOf, precisionOf } = useAssetMap();
    const setLine = useSetCreditLine();
    const setBookAuth = useSetBookAuth();
    const symbol = symbolOf(terms.assetId);
    const received = displayAmount(terms.limit);
    const grace = graceSecondsToPreset(terms.graceSeconds);

    const form = useAppForm({
        defaultValues: {
            limit: received,
            interestPct: ppmToPercentInput(terms.interestRatePpm),
            deplete: terms.depleteOnDebit,
            gracePreset: grace.preset,
            graceDays: grace.days,
            allowBook: true,
        },
        onSubmit: async ({ value }) => {
            await setLine.mutateAsync({
                debtor: terms.inviter,
                assetId: terms.assetId,
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
            if (value.allowBook) {
                await setBookAuth.mutateAsync({
                    creditor: terms.inviter,
                    assetId: terms.assetId,
                    remaining: displayAmount(terms.limit),
                    maxInterestRatePpm: terms.interestRatePpm,
                    expiresAtSeconds: 0,
                });
            }
            onDone();
        },
    });

    useEffect(() => {
        const next = graceSecondsToPreset(terms.graceSeconds);
        form.reset({
            limit: displayAmount(terms.limit),
            interestPct: ppmToPercentInput(terms.interestRatePpm),
            deplete: terms.depleteOnDebit,
            gracePreset: next.preset,
            graceDays: next.days,
            allowBook: true,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [terms]);

    return (
        <Card className="mx-auto mt-4 w-full max-w-md">
            <CardHeader>
                <div className="mx-auto">
                    <Handshake className="h-12 w-12" />
                </div>
                <CardTitle>Line them back?</CardTitle>
                <CardDescription>
                    <span className="text-foreground font-medium">
                        {terms.inviter}
                    </span>{" "}
                    lined you{" "}
                    <span className="text-foreground font-medium">
                        {received} {symbol}
                    </span>
                    . Return the favour with the same terms, edit them, or skip.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <dl className="text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <dt>Their line to you</dt>
                    <dd className="text-foreground text-right font-mono">
                        {received} {symbol}
                    </dd>
                    <dt>APR</dt>
                    <dd className="text-foreground text-right">
                        {ppmToPercent(terms.interestRatePpm)}
                    </dd>
                    <dt>Interest-free</dt>
                    <dd className="text-foreground text-right">
                        {formatGracePeriod(terms.graceSeconds)}
                    </dd>
                    <dt>Deplete</dt>
                    <dd className="text-foreground text-right">
                        {terms.depleteOnDebit ? "yes" : "no"}
                    </dd>
                </dl>
                <form
                    className="grid gap-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void form.handleSubmit();
                    }}
                >
                    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                        <form.AppField
                            name="limit"
                            validators={{
                                onChange: amountFieldValidator(
                                    precisionOf(terms.assetId),
                                    { allowZero: false },
                                ),
                                onSubmit: amountFieldValidator(
                                    precisionOf(terms.assetId),
                                    { allowZero: false },
                                ),
                            }}
                            children={(field) => (
                                <field.TextField
                                    label={`Your line to ${terms.inviter}`}
                                    inputMode="decimal"
                                    required
                                />
                            )}
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
                                onPresetChange={(p: GracePreset) => {
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
                    <form.AppField
                        name="deplete"
                        children={(field) => (
                            <field.CheckboxField label="Deplete limit on each draw (non-revolving)" />
                        )}
                    />
                    <form.AppField
                        name="allowBook"
                        children={(field) => (
                            <field.CheckboxField label={`Let ${terms.inviter} book expenses onto you (same ${received} ${symbol} remaining)`} />
                        )}
                    />
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={setLine.isPending || setBookAuth.isPending}
                            onClick={onDone}
                        >
                            Skip
                        </Button>
                        <form.AppForm>
                            <form.SubmitButton
                                labels={[
                                    `Line ${terms.inviter}`,
                                    "Saving…",
                                ]}
                                loading={
                                    setLine.isPending || setBookAuth.isPending
                                }
                            />
                        </form.AppForm>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

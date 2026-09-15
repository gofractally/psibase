import { useEffect } from "react";
import { Handshake } from "lucide-react";

import { GracePeriodField } from "@/components/form-fields";
import { NicknameContactField } from "@/components/nickname-contact-field";
import { useAssetMap } from "@/hooks/use-assets";
import { useBanxContacts } from "@/hooks/use-banx-contacts";
import { useForwardOffers } from "@/hooks/use-banx-data";
import {
    useSetBookAuth,
    useSetCreditLine,
    useSetGlobalForwardOffer,
} from "@/hooks/use-banx-mutations";
import { useSaveContact } from "@/hooks/use-save-contact";
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
    skipLine = false,
}: {
    terms: PendingReciprocal;
    onDone: () => void;
    /** True when a line back already exists — nickname only. */
    skipLine?: boolean;
}) {
    const { symbolOf, precisionOf } = useAssetMap();
    const setLine = useSetCreditLine();
    const setBookAuth = useSetBookAuth();
    const setForward = useSetGlobalForwardOffer();
    const saveContact = useSaveContact("/invite");
    const {
        isContact,
        hasReadPermission,
        isLoading: contactsLoading,
    } = useBanxContacts("/invite");
    const alreadyContact =
        hasReadPermission && isContact(terms.inviter);
    const { data: forwardOffers = [] } = useForwardOffers();
    const nowSec = Math.floor(Date.now() / 1000);
    const forwardAlreadyOn = forwardOffers.some(
        (p) =>
            p.isGlobal &&
            p.assetId === terms.assetId &&
            (p.expiresAt === 0 || p.expiresAt >= nowSec),
    );
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
            allowForward: true,
            nickname: "",
        },
        onSubmit: async ({ value }) => {
            if (!skipLine) {
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
                        remaining: value.limit.trim(),
                        maxInterestRatePpm: percentStringToPpm(
                            value.interestPct,
                            PPM_SCALE,
                        ),
                        expiresAtSeconds: 0,
                    });
                }
                if (value.allowForward && !forwardAlreadyOn) {
                    await setForward.mutateAsync({
                        assetId: terms.assetId,
                        feeFixed: "0",
                        feePercentPpm: 0,
                        maxLineAprPpm: 0,
                        expiresAtSeconds: 0,
                        allowUnknown: false,
                    });
                }
            }
            if (!alreadyContact) {
                await saveContact.mutateAsync({
                    account: terms.inviter,
                    nickname: value.nickname,
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
            allowForward: true,
            nickname: "",
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [terms]);

    useEffect(() => {
        if (!skipLine || contactsLoading) return;
        if (alreadyContact) onDone();
    }, [skipLine, contactsLoading, alreadyContact, onDone]);

    return (
        <Card className="mx-auto mt-4 w-full max-w-md">
            <CardHeader>
                <div className="mx-auto">
                    <Handshake className="h-12 w-12" />
                </div>
                <CardTitle>
                    {skipLine ? "Add them as a contact?" : "Line them back?"}
                </CardTitle>
                <CardDescription>
                    <span className="text-foreground font-medium">
                        {terms.inviter}
                    </span>{" "}
                    lined you{" "}
                    <span className="text-foreground font-medium">
                        {received} {symbol}
                    </span>
                    {skipLine
                        ? ". You already have a line back. Nickname them to add them to Payees, or skip."
                        : ". Return the favour with the same terms, edit them, or skip."}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {skipLine && (contactsLoading || alreadyContact) ? (
                    <p className="text-muted-foreground text-sm">Loading…</p>
                ) : null}
                {!alreadyContact ? (
                    <form.Field
                        name="nickname"
                        children={(field) => (
                            <NicknameContactField
                                account={terms.inviter}
                                value={field.state.value}
                                onChange={(v) => field.handleChange(v)}
                                disabled={
                                    setLine.isPending ||
                                    setBookAuth.isPending ||
                                    setForward.isPending ||
                                    saveContact.isPending
                                }
                            />
                        )}
                    />
                ) : null}
                {skipLine ? null : (
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
                )}
                <form
                    className="grid gap-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void form.handleSubmit();
                    }}
                >
                    {skipLine ? null : (
                    <>
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
                    <form.Subscribe
                        selector={(s) => s.values.limit}
                        children={(limit) => (
                            <form.AppField
                                name="allowBook"
                                children={(field) => (
                                    <field.CheckboxField
                                        label={`Let ${terms.inviter} book expenses onto you (same ${limit.trim() || received} ${symbol} remaining)`}
                                    />
                                )}
                            />
                        )}
                    />
                    {forwardAlreadyOn ? (
                        <p className="text-muted-foreground text-xs">
                            Path-forward is already on for {symbol} — friends
                            can pay through you.
                        </p>
                    ) : (
                        <form.AppField
                            name="allowForward"
                            children={(field) => (
                                <field.CheckboxField label={`Let friends path-pay through you in ${symbol} (closed, 0% fee, 0% max APR)`} />
                            )}
                        />
                    )}
                    </>
                    )}
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={
                                setLine.isPending ||
                                setBookAuth.isPending ||
                                setForward.isPending ||
                                saveContact.isPending
                            }
                            onClick={() => {
                                if (skipLine) {
                                    onDone();
                                    return;
                                }
                                void (async () => {
                                    if (!alreadyContact) {
                                        await saveContact.mutateAsync({
                                            account: terms.inviter,
                                            nickname:
                                                form.getFieldValue("nickname"),
                                        });
                                    }
                                    onDone();
                                })();
                            }}
                        >
                            {skipLine ? "Not now" : "Skip"}
                        </Button>
                        <form.AppForm>
                            <form.SubmitButton
                                labels={
                                    skipLine
                                        ? ["Continue", "Saving…"]
                                        : [`Line ${terms.inviter}`, "Saving…"]
                                }
                                loading={
                                    setLine.isPending ||
                                    setBookAuth.isPending ||
                                    setForward.isPending ||
                                    saveContact.isPending
                                }
                            />
                        </form.AppForm>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

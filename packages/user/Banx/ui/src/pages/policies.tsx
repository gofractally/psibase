import { useRef, useState } from "react";

import { ArrowDownUp, ChevronDown } from "lucide-react";

import { AssetField, ExpiresField } from "@/components/form-fields";
import { formatExpiresAt } from "@/components/expires-at-picker";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import {
    useCurrencyPolicies,
    useForwardOffers,
    useBuyClaimOffers,
} from "@/hooks/use-banx-data";
import {
    useConvert,
    useRemoveCurrencyPolicy,
    useSetCurrencyPolicy,
} from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    convertAtQuotedRate,
    flipLeftTyped,
    keptOnFlip,
    displayAmount,
    formatFxToRate,
    formatToPrecision,
    invertQuotedRate,
} from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";
import {
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    amountFieldValidator,
    percentFieldValidator,
    percentStringToPpm,
    useAppForm,
} from "@/lib/form";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@shared/shadcn/ui/collapsible";
import { toast } from "@shared/shadcn/ui/sonner";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export function PoliciesPage() {
    const { assets, byId, symbolOf, precisionOf } = useAssetMap();
    const { data: forwardOffers = [] } = useForwardOffers();
    const { data: buyClaimOffers = [] } = useBuyClaimOffers();
    const { data: currency = [] } = useCurrencyPolicies();
    const setCurrency = useSetCurrencyPolicy();
    const removeCurrency = useRemoveCurrencyPolicy();
    const convert = useConvert();
    const convertMinEdited = useRef(false);
    const convertMinSynced = useRef("");
    const [moreOpen, setMoreOpen] = useState(false);

    const currencyForm = useAppForm({
        defaultValues: {
            fromAsset: undefined as number | undefined,
            toAsset: undefined as number | undefined,
            feeFixed: "0",
            toRate: "1",
            aprPct: "0",
            remaining: "",
            expiresAtSeconds: 0,
        },
        onSubmit: async ({ value }) => {
            if (
                value.fromAsset === undefined ||
                value.toAsset === undefined ||
                !value.remaining.trim()
            )
                return;
            await new Promise<void>((resolve, reject) => {
                setCurrency.mutate(
                    {
                        fromAsset: value.fromAsset!,
                        toAsset: value.toAsset!,
                        feeFixed: value.feeFixed.trim(),
                        toRate: value.toRate.trim(),
                        toInterestRatePpm: percentStringToPpm(
                            value.aprPct,
                            PPM_SCALE,
                        ),
                        remaining: value.remaining.trim(),
                        expiresAtSeconds: value.expiresAtSeconds,
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    const convertForm = useAppForm({
        defaultValues: {
            counterparty: "",
            fromAsset: undefined as number | undefined,
            toAsset: undefined as number | undefined,
            amountFrom: "",
            minTo: "",
        },
        onSubmit: async ({ value }) => {
            if (
                value.fromAsset === undefined ||
                value.toAsset === undefined ||
                value.fromAsset === value.toAsset ||
                !value.counterparty.trim() ||
                !value.amountFrom.trim() ||
                !value.minTo.trim()
            )
                return;
            await new Promise<void>((resolve, reject) => {
                convert.mutate(
                    {
                        counterparty: value.counterparty.trim(),
                        fromAsset: value.fromAsset!,
                        toAsset: value.toAsset!,
                        amountFrom: value.amountFrom.trim(),
                        minTo: value.minTo.trim(),
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    return (
        <div className="space-y-10">
            <PageHeader
                title="Swaps"
                description="Change a debt from one asset to another. Post a rate, or take someone else's."
            />

            <section className="max-w-xl">
                <form
                    className="grid gap-4 rounded-xl border p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void currencyForm.handleSubmit();
                    }}
                >
                    <div>
                        <h2 className="font-medium">Post a rate</h2>
                        <p className="text-muted-foreground mt-1 text-sm">
                            Offer to change a debt between you from one asset
                            into another. The other person chooses whether to
                            swap. It works if they owe you, or if you owe them.
                        </p>
                    </div>
                    <currencyForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) => {
                            const fromSym =
                                values.fromAsset !== undefined
                                    ? symbolOf(values.fromAsset)
                                    : "from";
                            const toSym =
                                values.toAsset !== undefined
                                    ? symbolOf(values.toAsset)
                                    : "to";
                            const rateShown =
                                values.toAsset !== undefined
                                    ? (formatToPrecision(
                                          values.toRate,
                                          precisionOf(values.toAsset),
                                      ) ?? values.toRate)
                                    : values.toRate;
                            const bothAssets =
                                values.fromAsset !== undefined &&
                                values.toAsset !== undefined;
                            const feeText = values.feeFixed.trim();
                            const feeIsZero =
                                feeText === "" || feeText === "0";
                            return (
                                <>
                                    <div className="relative grid">
                                        <div className="bg-muted/60 space-y-2 rounded-2xl p-3">
                                            <currencyForm.Field
                                                name="fromAsset"
                                                children={(field) => (
                                                    <AssetField
                                                        label="Debt is in"
                                                        assets={assets}
                                                        value={
                                                            field.state.value
                                                        }
                                                        onChange={(id) =>
                                                            field.handleChange(
                                                                id,
                                                            )
                                                        }
                                                    />
                                                )}
                                            />
                                        </div>

                                        <div className="relative z-10 -my-3 flex justify-center">
                                            <Button
                                                type="button"
                                                size="icon"
                                                variant="outline"
                                                className="bg-background size-9 rounded-full border-2"
                                                aria-label="Swap the two assets"
                                                onClick={() => {
                                                    const from =
                                                        values.fromAsset;
                                                    const to = values.toAsset;
                                                    const fromPrec =
                                                        from !== undefined &&
                                                        byId.has(from)
                                                            ? precisionOf(from)
                                                            : undefined;
                                                    const toPrec =
                                                        to !== undefined &&
                                                        byId.has(to)
                                                            ? precisionOf(to)
                                                            : undefined;
                                                    if (
                                                        fromPrec ===
                                                            undefined ||
                                                        toPrec === undefined
                                                    ) {
                                                        const rate =
                                                            values.toRate.trim();
                                                        const feeText =
                                                            values.feeFixed.trim();
                                                        const openText =
                                                            values.remaining.trim();
                                                        const needsConvert =
                                                            (rate !== "" &&
                                                                rate !==
                                                                    "1") ||
                                                            (feeText !== "" &&
                                                                feeText !==
                                                                    "0") ||
                                                            (openText !== "" &&
                                                                openText !==
                                                                    "0");
                                                        if (needsConvert) {
                                                            toast.error(
                                                                from !==
                                                                    undefined &&
                                                                    to !==
                                                                        undefined
                                                                    ? "Asset precision isn't loaded yet."
                                                                    : "Pick both assets before flipping a rate.",
                                                            );
                                                            return;
                                                        }
                                                        currencyForm.setFieldValue(
                                                            "fromAsset",
                                                            to,
                                                        );
                                                        currencyForm.setFieldValue(
                                                            "toAsset",
                                                            from,
                                                        );
                                                        return;
                                                    }
                                                    currencyForm.setFieldValue(
                                                        "fromAsset",
                                                        to,
                                                    );
                                                    currencyForm.setFieldValue(
                                                        "toAsset",
                                                        from,
                                                    );
                                                    const inverted =
                                                        invertQuotedRate(
                                                            values.toRate,
                                                            fromPrec,
                                                            toPrec,
                                                        );
                                                    const fee =
                                                        convertAtQuotedRate(
                                                            values.feeFixed,
                                                            values.toRate,
                                                            fromPrec,
                                                            toPrec,
                                                        );
                                                    const open =
                                                        convertAtQuotedRate(
                                                            values.remaining,
                                                            values.toRate,
                                                            fromPrec,
                                                            toPrec,
                                                        );
                                                    const nextRate =
                                                        keptOnFlip(
                                                            values.toRate,
                                                            inverted,
                                                            "",
                                                        );
                                                    const nextFee = keptOnFlip(
                                                        values.feeFixed,
                                                        fee,
                                                        "0",
                                                    );
                                                    const nextOpen = keptOnFlip(
                                                        values.remaining,
                                                        open,
                                                        "",
                                                    );
                                                    if (
                                                        flipLeftTyped(
                                                            values.toRate,
                                                            inverted,
                                                            nextRate,
                                                        ) ||
                                                        flipLeftTyped(
                                                            values.feeFixed,
                                                            fee,
                                                            nextFee,
                                                        ) ||
                                                        flipLeftTyped(
                                                            values.remaining,
                                                            open,
                                                            nextOpen,
                                                        )
                                                    ) {
                                                        toast.error(
                                                            "That amount is too small to convert at this rate, so it was left as typed.",
                                                        );
                                                    }
                                                    currencyForm.setFieldValue(
                                                        "toRate",
                                                        nextRate,
                                                    );
                                                    currencyForm.setFieldValue(
                                                        "feeFixed",
                                                        nextFee,
                                                    );
                                                    currencyForm.setFieldValue(
                                                        "remaining",
                                                        nextOpen,
                                                    );
                                                }}
                                            >
                                                <ArrowDownUp className="size-4" />
                                            </Button>
                                        </div>

                                        <div className="bg-muted/60 space-y-2 rounded-2xl p-3">
                                            <currencyForm.Field
                                                name="toAsset"
                                                children={(field) => (
                                                    <AssetField
                                                        label="Debt becomes"
                                                        assets={assets}
                                                        value={
                                                            field.state.value
                                                        }
                                                        onChange={(id) =>
                                                            field.handleChange(
                                                                id,
                                                            )
                                                        }
                                                    />
                                                )}
                                            />
                                            <currencyForm.AppField
                                                name="toRate"
                                                children={(field) => (
                                                    <field.TextField
                                                        label={
                                                            bothAssets
                                                                ? `${toSym} for each 1 ${fromSym}`
                                                                : "How much new debt"
                                                        }
                                                        inputMode="decimal"
                                                        placeholder="0.45"
                                                    />
                                                )}
                                            />
                                        </div>
                                    </div>

                                    <p className="text-muted-foreground text-sm">
                                        {bothAssets &&
                                        values.fromAsset === values.toAsset ? (
                                            <>Pick two different assets.</>
                                        ) : bothAssets && rateShown ? (
                                            <>
                                                <span className="text-foreground font-medium">
                                                    1 {fromSym}
                                                </span>{" "}
                                                of debt can become{" "}
                                                <span className="text-foreground font-medium">
                                                    {rateShown} {toSym}
                                                </span>
                                                {feeIsZero
                                                    ? "."
                                                    : ", after your fee."}
                                            </>
                                        ) : (
                                            <>Pick both assets and a rate.</>
                                        )}
                                    </p>

                                    <currencyForm.AppField
                                        name="remaining"
                                        validators={
                                            values.fromAsset === undefined
                                                ? undefined
                                                : {
                                                      onChange:
                                                          amountFieldValidator(
                                                              precisionOf(
                                                                  values.fromAsset,
                                                              ),
                                                              {
                                                                  allowZero:
                                                                      false,
                                                              },
                                                          ),
                                                      onSubmit:
                                                          amountFieldValidator(
                                                              precisionOf(
                                                                  values.fromAsset,
                                                              ),
                                                              {
                                                                  allowZero:
                                                                      false,
                                                              },
                                                          ),
                                                  }
                                        }
                                        children={(field) => (
                                            <field.TextField
                                                label={
                                                    values.fromAsset !==
                                                    undefined
                                                        ? `Left to swap (${fromSym})`
                                                        : "Left to swap"
                                                }
                                                description="How much of that debt can still be swapped. Posting again replaces this."
                                                inputMode="decimal"
                                                placeholder={
                                                    values.fromAsset !==
                                                    undefined
                                                        ? amountPlaceholder(
                                                              precisionOf(
                                                                  values.fromAsset,
                                                              ),
                                                          )
                                                        : "0"
                                                }
                                            />
                                        )}
                                    />
                                    <Collapsible
                                        open={moreOpen}
                                        onOpenChange={setMoreOpen}
                                    >
                                        <CollapsibleTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="text-muted-foreground h-8 w-full justify-between px-2 text-sm font-medium"
                                            >
                                                Fee, interest, and expiry
                                                <ChevronDown
                                                    className={cn(
                                                        "size-4 transition-transform duration-200",
                                                        moreOpen && "rotate-180",
                                                    )}
                                                />
                                            </Button>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent className="grid gap-4 pt-2">
                                            <p className="text-muted-foreground text-sm">
                                                A payment that changes asset
                                                while it goes through you uses
                                                this rate too.
                                            </p>
                                            <currencyForm.AppField
                                                name="feeFixed"
                                                children={(field) => (
                                                    <field.TextField
                                                        label={
                                                            values.fromAsset !==
                                                            undefined
                                                                ? `Fee, taken from the ${fromSym}`
                                                                : "Fee"
                                                        }
                                                        description="Comes out of the current debt, before the rate."
                                                        inputMode="decimal"
                                                        placeholder={
                                                            values.fromAsset !==
                                                            undefined
                                                                ? amountPlaceholder(
                                                                      precisionOf(
                                                                          values.fromAsset,
                                                                      ),
                                                                  )
                                                                : "0"
                                                        }
                                                    />
                                                )}
                                            />
                                            <currencyForm.AppField
                                                name="aprPct"
                                                validators={{
                                                    onChange:
                                                        percentFieldValidator(
                                                            MAX_PERCENT,
                                                        ),
                                                    onSubmit:
                                                        percentFieldValidator(
                                                            MAX_PERCENT,
                                                        ),
                                                }}
                                                children={(field) => (
                                                    <field.TextField
                                                        label="Interest on the new debt %"
                                                        inputMode="decimal"
                                                        min={0}
                                                        max={MAX_PERCENT}
                                                        step={MIN_PERCENT_STEP}
                                                    />
                                                )}
                                            />
                                            <currencyForm.Field
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
                                        </CollapsibleContent>
                                    </Collapsible>
                                </>
                            );
                        }}
                    />
                    <currencyForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) => (
                            <currencyForm.AppForm>
                                <currencyForm.SubmitButton
                                    labels={["Post rate", "Posting…"]}
                                    loading={setCurrency.isPending}
                                    disabled={
                                        values.fromAsset === undefined ||
                                        values.toAsset === undefined ||
                                        values.fromAsset === values.toAsset ||
                                        !values.remaining.trim()
                                    }
                                />
                            </currencyForm.AppForm>
                        )}
                    />
                </form>
            </section>

            <section className="grid max-w-xl gap-3 rounded-lg border p-4">
                <h2 className="font-medium">Take their rate</h2>
                <p className="text-muted-foreground text-sm">
                    Change a debt between you, using a rate they posted. It
                    works if they owe you, or if you owe them.
                </p>
                <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void convertForm.handleSubmit();
                    }}
                >
                    <convertForm.AppField
                        name="counterparty"
                        children={(field) => (
                            <field.TextField
                                label="Account"
                                description="Who posted the rate."
                                required
                            />
                        )}
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                        <convertForm.Field
                            name="fromAsset"
                            children={(field) => (
                                <AssetField
                                    label="Debt is in"
                                    assets={assets}
                                    value={field.state.value}
                                    onChange={(id) => field.handleChange(id)}
                                />
                            )}
                        />
                        <convertForm.Field
                            name="toAsset"
                            children={(field) => (
                                <AssetField
                                    label="Debt becomes"
                                    assets={assets}
                                    value={field.state.value}
                                    onChange={(id) => field.handleChange(id)}
                                />
                            )}
                        />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <convertForm.AppField
                            name="amountFrom"
                            listeners={{
                                onChange: ({ value }) => {
                                    if (convertMinEdited.current) return;
                                    const next = String(value ?? "");
                                    convertMinSynced.current = next;
                                    convertForm.setFieldValue("minTo", next);
                                },
                            }}
                            children={(field) => (
                                <field.TextField
                                    label="How much to swap"
                                    inputMode="decimal"
                                />
                            )}
                        />
                        <convertForm.AppField
                            name="minTo"
                            listeners={{
                                onChange: ({ value }) => {
                                    if (
                                        String(value ?? "") !==
                                        convertMinSynced.current
                                    ) {
                                        convertMinEdited.current = true;
                                    }
                                },
                            }}
                            children={(field) => (
                                <field.TextField
                                    label="New debt at least"
                                    inputMode="decimal"
                                />
                            )}
                        />
                    </div>
                    <convertForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) => (
                            <convertForm.AppForm>
                                {values.fromAsset !== undefined &&
                                values.toAsset !== undefined &&
                                values.fromAsset === values.toAsset ? (
                                    <p className="text-muted-foreground text-sm">
                                        Pick two different assets.
                                    </p>
                                ) : null}
                                <convertForm.SubmitButton
                                    labels={["Swap", "Swapping…"]}
                                    loading={convert.isPending}
                                    disabled={
                                        !values.counterparty.trim() ||
                                        values.fromAsset === undefined ||
                                        values.toAsset === undefined ||
                                        values.fromAsset === values.toAsset ||
                                        !values.amountFrom.trim() ||
                                        !values.minTo.trim()
                                    }
                                />
                            </convertForm.AppForm>
                        )}
                    />
                </form>
            </section>

            <section className="space-y-4">
                <h2 className="font-medium">Payments through you</h2>
                {forwardOffers.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        None yet. On Accounts, turn on Forward if you want
                        payments to pass through you.
                    </p>
                ) : (
                    <div className="overflow-x-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Next account</TableHead>
                                    <TableHead>Asset</TableHead>
                                    <TableHead className="text-right">
                                        Fee
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Fee %
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Interest limit
                                    </TableHead>
                                    <TableHead className="text-right">
                                        New people
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Expires
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {forwardOffers.map((p) => (
                                    <TableRow
                                        key={`${p.isGlobal ? "g" : p.nextHop}-${p.assetId}`}
                                    >
                                        <TableCell>
                                            {p.isGlobal ? "Anyone" : p.nextHop}
                                        </TableCell>
                                        <TableCell>
                                            {symbolOf(p.assetId)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {displayAmount(p.feeFixed)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {ppmToPercent(p.feePercentPpm)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {ppmToPercent(p.maxLineAprPpm)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm">
                                            {p.allowUnknown
                                                ? "Yes"
                                                : "Only people you know"}
                                        </TableCell>
                                        <TableCell className="text-right text-sm">
                                            {formatExpiresAt(p.expiresAt)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </section>

            <section className="space-y-4">
                <h2 className="font-medium">Buying and selling</h2>
                {buyClaimOffers.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        None yet. On Accounts, use Buy claims.
                    </p>
                ) : (
                    <div className="overflow-x-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Buy or sell</TableHead>
                                    <TableHead>Who owes</TableHead>
                                    <TableHead>Asset</TableHead>
                                    <TableHead className="text-right">
                                        Fee
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Fee %
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Left
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Expires
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {buyClaimOffers.map((p) => (
                                    <TableRow
                                        key={`${p.side}-${p.isGlobal ? "g" : p.debtor}-${p.assetId}`}
                                    >
                                        <TableCell>
                                            {p.isSell ? "Sell" : "Buy"}
                                        </TableCell>
                                        <TableCell>
                                            {p.isGlobal ? "Anyone" : p.debtor}
                                        </TableCell>
                                        <TableCell>
                                            {symbolOf(p.assetId)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {displayAmount(p.feeFixed)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {ppmToPercent(p.feePercentPpm)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {displayAmount(p.remaining)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm">
                                            {formatExpiresAt(p.expiresAt)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </section>

            <section>
                <h2 className="mb-2 font-medium">Your rates</h2>
                {currency.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        None yet. Post a rate above.
                    </p>
                ) : (
                    <div className="overflow-x-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Swap</TableHead>
                                    <TableHead className="text-right">
                                        Fee
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Becomes
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Interest
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Left
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Expires
                                    </TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {currency.map((p) => (
                                    <TableRow
                                        key={`${p.fromAsset}-${p.toAsset}`}
                                    >
                                        <TableCell>
                                            {symbolOf(p.fromAsset)} →{" "}
                                            {symbolOf(p.toAsset)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {displayAmount(p.feeFixed)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            1 →{" "}
                                            {formatFxToRate(
                                                p.fxRate,
                                                precisionOf(p.fromAsset),
                                                precisionOf(p.toAsset),
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {ppmToPercent(p.toInterestRatePpm)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {displayAmount(p.remaining)}{" "}
                                            {symbolOf(p.fromAsset)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm">
                                            {formatExpiresAt(p.expiresAt)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={
                                                    removeCurrency.isPending
                                                }
                                                onClick={() =>
                                                    removeCurrency.mutate({
                                                        fromAsset: p.fromAsset,
                                                        toAsset: p.toAsset,
                                                    })
                                                }
                                            >
                                                Remove
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </section>
        </div>
    );
}

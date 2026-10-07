import { useMemo, useRef, useState } from "react";
import { useStore } from "@tanstack/react-form";

import { AssetField, ExpiresField } from "@/components/form-fields";
import { formatExpiresAt } from "@/components/expires-at-picker";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import {
    useCashQuotes,
    useCashVault,
    useTokenPrecisionMap,
} from "@/hooks/use-banx-data";
import {
    useCashFund,
    useCashIn,
    useCashOut,
    useCashWithdraw,
    useRemoveCashQuote,
    useSetCashQuote,
} from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    applyQuotedRate,
    convertAtQuotedRate,
    flipLeftTyped,
    keptOnFlip,
    displayAmount,
    humanToRaw,
    formatFxToRate,
    formatToPrecision,
    invertQuotedRate,
} from "@/lib/amount";
import { amountFieldValidator, useAppForm } from "@/lib/form";
import type { CashQuote } from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { toast } from "@shared/shadcn/ui/sonner";
import { Label } from "@shared/shadcn/ui/label";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@shared/shadcn/ui/tabs";

function parseTokenId(raw: string): number | undefined {
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n <= 0) return undefined;
    return n;
}

function quoteLive(q: CashQuote, nowSec: number): boolean {
    return q.expiresAt === 0 || q.expiresAt >= nowSec;
}

function precisionGapMessage(
    tokenId: number | undefined,
    tokenMissing: boolean,
    pending: ReadonlySet<number>,
    failed: ReadonlySet<number>,
): string {
    if (tokenMissing && tokenId !== undefined) {
        if (failed.has(tokenId)) {
            return `Couldn't load precision for token #${tokenId}.`;
        }
        if (pending.has(tokenId)) {
            return `Token #${tokenId} precision is still loading.`;
        }
        return `Couldn't load precision for token #${tokenId}.`;
    }
    return "Asset precision isn't loaded yet.";
}

function tokenName(id: number | undefined): string {
    return id === undefined ? "tokens" : `#${id}`;
}

function nonzeroAmount(amount: string): boolean {
    const shown = displayAmount(amount);
    return shown !== "0" && !/^0\.0+$/.test(shown);
}

function quoteOpen(q: CashQuote, nowSec: number): boolean {
    return quoteLive(q, nowSec) && nonzeroAmount(q.remaining);
}

function tradeLine(
    q: Pick<CashQuote, "isOut" | "assetId" | "tokenId" | "fxRate">,
    symbolOf: (id: number) => string,
    assetPrecision: number | undefined,
    tokenPrecision: number | undefined,
): string {
    if (assetPrecision === undefined || tokenPrecision === undefined) {
        return "Loading rate";
    }
    const banx = symbolOf(q.assetId);
    const token = tokenName(q.tokenId);
    return q.isOut
        ? `1 ${banx} → ${formatFxToRate(q.fxRate, assetPrecision, tokenPrecision)} ${token}`
        : `1 ${token} → ${formatFxToRate(q.fxRate, tokenPrecision, assetPrecision)} ${banx}`;
}

export function CashPage() {
    const { data: user } = useCurrentUser();
    const { assets, byId, symbolOf, precisionOf } = useAssetMap();
    const quoteCtxRef = useRef({
        assetPrecision: (_id: number): number | undefined => undefined,
        tokenPrecision: new Map<number, number>(),
        tokenPending: new Set<number>() as ReadonlySet<number>,
        tokenFailed: new Set<number>() as ReadonlySet<number>,
    });
    const takeCtxRef = useRef({
        liveDesk: [] as CashQuote[],
        tokenPrecision: new Map<number, number>(),
        tokenPending: new Set<number>() as ReadonlySet<number>,
        tokenFailed: new Set<number>() as ReadonlySet<number>,
        assetPrecision: (_id: number): number | undefined => undefined,
        cashier: "",
    });
    const { data: myQuotes = [] } = useCashQuotes(user ?? null);
    const { data: allQuotes = [] } = useCashQuotes();
    const { data: vault = [] } = useCashVault();
    const setQuote = useSetCashQuote();
    const removeQuote = useRemoveCashQuote();
    const fund = useCashFund();
    const withdraw = useCashWithdraw();
    const cashOut = useCashOut();
    const cashIn = useCashIn();
    const nowSec = Math.floor(Date.now() / 1000);

    const quoteForm = useAppForm({
        defaultValues: {
            assetId: undefined as number | undefined,
            tokenId: "",
            isOut: true,
            feeFixed: "0",
            toRate: "1",
            remaining: "",
            expiresAtSeconds: 0,
        },
        onSubmit: async ({ value }) => {
            const tokenId = parseTokenId(value.tokenId);
            if (value.assetId === undefined || tokenId === undefined) return;
            const ctx = quoteCtxRef.current;
            const fromPrec = value.isOut
                ? ctx.assetPrecision(value.assetId)
                : ctx.tokenPrecision.get(tokenId);
            const toPrec = value.isOut
                ? ctx.tokenPrecision.get(tokenId)
                : ctx.assetPrecision(value.assetId);
            if (fromPrec === undefined || toPrec === undefined) {
                toast.error(
                    precisionGapMessage(
                        tokenId,
                        value.isOut
                            ? toPrec === undefined
                            : fromPrec === undefined,
                        ctx.tokenPending,
                        ctx.tokenFailed,
                    ),
                );
                return;
            }
            await new Promise<void>((resolve, reject) => {
                setQuote.mutate(
                    {
                        assetId: value.assetId!,
                        tokenId,
                        isOut: value.isOut,
                        feeFixed: value.feeFixed.trim(),
                        toRate: value.toRate.trim(),
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

    const fundForm = useAppForm({
        defaultValues: { tokenId: "", amount: "" },
        onSubmit: async ({ value }) => {
            const tokenId = parseTokenId(value.tokenId);
            if (tokenId === undefined) return;
            await new Promise<void>((resolve, reject) => {
                fund.mutate(
                    { tokenId, amount: value.amount.trim() },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    const [takeCashier, setTakeCashier] = useState("");
    const cashier = takeCashier.trim();
    const { data: deskQuotes = [] } = useCashQuotes(cashier || null);
    const liveDesk = deskQuotes.filter((q) => quoteOpen(q, nowSec));

    const takeForm = useAppForm({
        defaultValues: {
            isOut: true,
            assetId: undefined as number | undefined,
            tokenId: "",
            amount: "",
            minOut: "",
        },
        onSubmit: async ({ value }) => {
            const ctx = takeCtxRef.current;
            const tokenId = parseTokenId(value.tokenId);
            if (
                !ctx.cashier ||
                value.assetId === undefined ||
                tokenId === undefined
            ) {
                return;
            }
            const quote = ctx.liveDesk.find(
                (x) =>
                    x.isOut === value.isOut &&
                    x.assetId === value.assetId &&
                    x.tokenId === tokenId,
            );
            const assetPrec = ctx.assetPrecision(value.assetId);
            const tokenP = ctx.tokenPrecision.get(tokenId);
            const fromPrec = value.isOut ? assetPrec : tokenP;
            const toPrec = value.isOut ? tokenP : assetPrec;
            if (quote && (fromPrec === undefined || toPrec === undefined)) {
                toast.error(
                    precisionGapMessage(
                        tokenId,
                        value.isOut
                            ? toPrec === undefined
                            : fromPrec === undefined,
                        ctx.tokenPending,
                        ctx.tokenFailed,
                    ),
                );
                return;
            }
            if (
                quote &&
                fromPrec !== undefined &&
                humanToRaw(value.amount, fromPrec) >
                    humanToRaw(quote.remaining, fromPrec)
            ) {
                toast.error("That is more than this rate still has open.");
                return;
            }
            let minOut = value.minOut.trim();
            if (
                !minOut &&
                quote &&
                fromPrec !== undefined &&
                toPrec !== undefined
            ) {
                const quoted = applyQuotedRate(
                    value.amount,
                    quote.feeFixed,
                    quote.fxRate,
                    fromPrec,
                    toPrec,
                );
                if (!quoted) {
                    toast.error("This quote can't price that amount.");
                    return;
                }
                minOut = quoted;
            }
            if (!minOut) minOut = "0";
            await new Promise<void>((resolve, reject) => {
                const opts = {
                    onSuccess: () => resolve(),
                    onError: (e: Error) => reject(e),
                };
                if (value.isOut) {
                    cashOut.mutate(
                        {
                            cashier: ctx.cashier,
                            assetId: value.assetId!,
                            tokenId,
                            amountBanx: value.amount.trim(),
                            minTokens: minOut,
                        },
                        opts,
                    );
                } else {
                    cashIn.mutate(
                        {
                            cashier: ctx.cashier,
                            assetId: value.assetId!,
                            tokenId,
                            amountTokens: value.amount.trim(),
                            minBanx: minOut,
                        },
                        opts,
                    );
                }
            });
        },
    });

    const quoteTokenRaw = useStore(quoteForm.store, (s) => s.values.tokenId);
    const takeTokenRaw = useStore(takeForm.store, (s) => s.values.tokenId);
    const editingTokenIds = [quoteTokenRaw, takeTokenRaw].flatMap((raw) => {
        const id = parseTokenId(raw);
        return id === undefined ? [] : [id];
    });
    const {
        precision: tokenPrec,
        pending: tokenPending,
        failed: tokenFailed,
    } = useTokenPrecisionMap([
        ...myQuotes.map((q) => q.tokenId),
        ...deskQuotes.map((q) => q.tokenId),
        ...vault.map((v) => v.tokenId),
        ...editingTokenIds,
    ]);
    const assetPrecision = (id: number | undefined): number | undefined =>
        id !== undefined && byId.has(id) ? precisionOf(id) : undefined;
    const tokPrec = (id: number | undefined): number | undefined =>
        id !== undefined ? tokenPrec.get(id) : undefined;
    quoteCtxRef.current = {
        assetPrecision: (id) => assetPrecision(id),
        tokenPrecision: tokenPrec,
        tokenPending,
        tokenFailed,
    };
    takeCtxRef.current = {
        liveDesk,
        tokenPrecision: tokenPrec,
        tokenPending,
        tokenFailed,
        assetPrecision: (id) => assetPrecision(id),
        cashier,
    };

    const applyDirection = (nextIsOut: boolean) => {
        const values = quoteForm.state.values;
        if (values.isOut === nextIsOut) return;
        const tokenId = parseTokenId(values.tokenId);
        const banxPrec = assetPrecision(values.assetId);
        const tokenP = tokPrec(tokenId);
        const fromPrec = values.isOut ? banxPrec : tokenP;
        const toPrec = values.isOut ? tokenP : banxPrec;
        if (fromPrec === undefined || toPrec === undefined) {
            const rate = values.toRate.trim();
            const fee = values.feeFixed.trim();
            const budget = values.remaining.trim();
            const needsConvert =
                (rate !== "" && rate !== "1") ||
                (fee !== "" && fee !== "0") ||
                budget !== "";
            if (needsConvert) {
                toast.error(
                    tokenId !== undefined && tokenP === undefined
                        ? precisionGapMessage(
                              tokenId,
                              true,
                              tokenPending,
                              tokenFailed,
                          )
                        : values.assetId !== undefined &&
                            banxPrec === undefined
                          ? "Asset precision isn't loaded yet."
                          : "Pick both sides before flipping a rate.",
                );
                return;
            }
            quoteForm.setFieldValue("isOut", nextIsOut);
            return;
        }
        quoteForm.setFieldValue("isOut", nextIsOut);
        const inverted = invertQuotedRate(values.toRate, fromPrec, toPrec);
        const fee = convertAtQuotedRate(
            values.feeFixed,
            values.toRate,
            fromPrec,
            toPrec,
        );
        const budget = convertAtQuotedRate(
            values.remaining,
            values.toRate,
            fromPrec,
            toPrec,
        );
        const nextRate = keptOnFlip(values.toRate, inverted, "");
        const nextFee = keptOnFlip(values.feeFixed, fee, "0");
        const nextBudget = keptOnFlip(values.remaining, budget, "");
        if (
            flipLeftTyped(values.toRate, inverted, nextRate) ||
            flipLeftTyped(values.feeFixed, fee, nextFee) ||
            flipLeftTyped(values.remaining, budget, nextBudget)
        ) {
            toast.error(
                "That amount is too small to convert at this rate, so it was left as typed.",
            );
        }
        quoteForm.setFieldValue("toRate", nextRate);
        quoteForm.setFieldValue("feeFixed", nextFee);
        quoteForm.setFieldValue("remaining", nextBudget);
    };

    const desks = useMemo(() => {
        const names = new Set<string>();
        for (const q of allQuotes) {
            if (q.poster !== user && quoteOpen(q, nowSec)) names.add(q.poster);
        }
        return [...names].sort();
    }, [allQuotes, user, nowSec]);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Cash"
                description="Swap Banx and tokens at a posted rate."
            />

            <Tabs defaultValue="swap" className="gap-6">
                <TabsList>
                    <TabsTrigger value="swap">Swap</TabsTrigger>
                    <TabsTrigger value="desk">Your desk</TabsTrigger>
                </TabsList>

                <TabsContent value="swap">
                    <form
                        className="mx-auto grid w-full max-w-md gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void takeForm.handleSubmit();
                        }}
                    >
                        <div className="grid gap-2">
                            <Label htmlFor="cashier">Cashier</Label>
                            {desks.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {desks.map((name) => (
                                        <Button
                                            key={name}
                                            type="button"
                                            size="sm"
                                            variant={
                                                cashier === name
                                                    ? "default"
                                                    : "outline"
                                            }
                                            onClick={() => setTakeCashier(name)}
                                        >
                                            {name}
                                        </Button>
                                    ))}
                                </div>
                            ) : null}
                            <Input
                                id="cashier"
                                value={takeCashier}
                                onChange={(e) => setTakeCashier(e.target.value)}
                                placeholder="Account name"
                                autoComplete="off"
                            />
                        </div>

                        {cashier && liveDesk.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                {cashier} has no rates up right now.
                            </p>
                        ) : null}
                        {!cashier ? (
                            <p className="text-muted-foreground text-sm">
                                Choose a cashier to see what they offer.
                            </p>
                        ) : null}

                        <takeForm.Subscribe
                            selector={(s) => s.values}
                            children={(values) => {
                                const tokenId = parseTokenId(values.tokenId);
                                const selected = liveDesk.find(
                                    (q) =>
                                        q.isOut === values.isOut &&
                                        q.assetId === values.assetId &&
                                        q.tokenId === tokenId,
                                );
                                const fromPrec = values.isOut
                                    ? assetPrecision(values.assetId)
                                    : tokPrec(tokenId);
                                const toPrec = values.isOut
                                    ? tokPrec(tokenId)
                                    : assetPrecision(values.assetId);
                                const payExceedsRemaining =
                                    !!selected &&
                                    fromPrec !== undefined &&
                                    values.amount.trim() !== "" &&
                                    humanToRaw(values.amount, fromPrec) >
                                        humanToRaw(
                                            selected.remaining,
                                            fromPrec,
                                        );
                                const quoted =
                                    selected &&
                                    !payExceedsRemaining &&
                                    values.amount.trim() &&
                                    fromPrec !== undefined &&
                                    toPrec !== undefined
                                        ? applyQuotedRate(
                                              values.amount,
                                              selected.feeFixed,
                                              selected.fxRate,
                                              fromPrec,
                                              toPrec,
                                          )
                                        : null;
                                const payUnit = selected
                                    ? selected.isOut
                                        ? symbolOf(selected.assetId)
                                        : tokenName(selected.tokenId)
                                    : "";
                                const getUnit = selected
                                    ? selected.isOut
                                        ? tokenName(selected.tokenId)
                                        : symbolOf(selected.assetId)
                                    : "";
                                return (
                                    <>
                                        {liveDesk.length > 0 ? (
                                            <div className="grid gap-2">
                                                {liveDesk.map((q) => {
                                                    const on =
                                                        q.isOut ===
                                                            values.isOut &&
                                                        q.assetId ===
                                                            values.assetId &&
                                                        q.tokenId === tokenId;
                                                    const assetP =
                                                        assetPrecision(
                                                            q.assetId,
                                                        );
                                                    const tokenP = tokPrec(
                                                        q.tokenId,
                                                    );
                                                    return (
                                                        <button
                                                            key={`${q.isOut}-${q.assetId}-${q.tokenId}`}
                                                            type="button"
                                                            aria-pressed={on}
                                                            className={cn(
                                                                "rounded-xl border px-4 py-3 text-left transition-colors",
                                                                on
                                                                    ? "border-foreground bg-muted"
                                                                    : "hover:bg-muted/60",
                                                            )}
                                                            onClick={() => {
                                                                const same =
                                                                    values.isOut ===
                                                                        q.isOut &&
                                                                    values.assetId ===
                                                                        q.assetId &&
                                                                    tokenId ===
                                                                        q.tokenId;
                                                                takeForm.setFieldValue(
                                                                    "isOut",
                                                                    q.isOut,
                                                                );
                                                                takeForm.setFieldValue(
                                                                    "assetId",
                                                                    q.assetId,
                                                                );
                                                                takeForm.setFieldValue(
                                                                    "tokenId",
                                                                    String(
                                                                        q.tokenId,
                                                                    ),
                                                                );
                                                                if (!same) {
                                                                    takeForm.setFieldValue(
                                                                        "amount",
                                                                        "",
                                                                    );
                                                                    takeForm.setFieldValue(
                                                                        "minOut",
                                                                        "",
                                                                    );
                                                                }
                                                            }}
                                                        >
                                                            <span className="flex items-baseline justify-between gap-3">
                                                                <span className="font-medium">
                                                                    {q.isOut
                                                                        ? "Get tokens"
                                                                        : "Get Banx"}
                                                                </span>
                                                                <span className="text-muted-foreground text-xs">
                                                                    {displayAmount(
                                                                        q.remaining,
                                                                    )}{" "}
                                                                    {q.isOut
                                                                        ? symbolOf(
                                                                              q.assetId,
                                                                          )
                                                                        : tokenName(
                                                                              q.tokenId,
                                                                          )}{" "}
                                                                    open
                                                                </span>
                                                            </span>
                                                            <span className="text-muted-foreground mt-1 block font-mono text-sm">
                                                                {tradeLine(
                                                                    q,
                                                                    symbolOf,
                                                                    assetP,
                                                                    tokenP,
                                                                )}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : null}

                                        {selected ? (
                                            <div className="grid gap-3">
                                                {!selected.isOut ? (
                                                    <p className="text-muted-foreground text-sm">
                                                        Tokens come from your
                                                        own vault. Add them on
                                                        Your desk.
                                                    </p>
                                                ) : null}
                                                <div className="bg-muted/60 rounded-2xl p-3">
                                                    <takeForm.AppField
                                                        name="amount"
                                                        children={(field) => (
                                                            <field.TextField
                                                                label="You pay"
                                                                inputMode="decimal"
                                                                endContent={
                                                                    <span className="text-muted-foreground px-3 text-sm">
                                                                        {
                                                                            payUnit
                                                                        }
                                                                    </span>
                                                                }
                                                            />
                                                        )}
                                                    />
                                                </div>
                                                <div className="bg-muted/60 rounded-2xl px-4 py-3">
                                                    <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                                                        You get
                                                    </p>
                                                    <p className="mt-1 text-2xl font-semibold tracking-tight">
                                                        {quoted ?? "—"}
                                                        <span className="text-muted-foreground ml-2 text-base font-medium">
                                                            {getUnit}
                                                        </span>
                                                    </p>
                                                    {payExceedsRemaining ? (
                                                        <p className="text-destructive mt-1 text-sm">
                                                            Only{" "}
                                                            {displayAmount(
                                                                selected.remaining,
                                                            )}{" "}
                                                            {payUnit} is still
                                                            open.
                                                        </p>
                                                    ) : null}
                                                    <p className="text-muted-foreground mt-1 font-mono text-xs">
                                                        {fromPrec ===
                                                            undefined ||
                                                        toPrec === undefined
                                                            ? "Loading rate"
                                                            : tradeLine(
                                                                  selected,
                                                                  symbolOf,
                                                                  assetPrecision(
                                                                      selected.assetId,
                                                                  ),
                                                                  tokPrec(
                                                                      selected.tokenId,
                                                                  ),
                                                              )}
                                                    </p>
                                                    {nonzeroAmount(selected.feeFixed) ? (
                                                        <p className="text-muted-foreground mt-1 text-xs">
                                                            Fee{" "}
                                                            {displayAmount(
                                                                selected.feeFixed,
                                                            )}{" "}
                                                            {payUnit} comes off
                                                            what you pay.
                                                        </p>
                                                    ) : null}
                                                </div>
                                                <details>
                                                    <summary className="text-muted-foreground cursor-pointer text-sm">
                                                        Minimum you'll accept
                                                    </summary>
                                                    <div className="mt-2">
                                                        <takeForm.AppField
                                                            name="minOut"
                                                            children={(
                                                                field,
                                                            ) => (
                                                                <field.TextField
                                                                    label="At least"
                                                                    inputMode="decimal"
                                                                    placeholder={
                                                                        quoted ??
                                                                        "The quoted amount"
                                                                    }
                                                                    endContent={
                                                                        <span className="text-muted-foreground px-3 text-sm">
                                                                            {
                                                                                getUnit
                                                                            }
                                                                        </span>
                                                                    }
                                                                />
                                                            )}
                                                        />
                                                    </div>
                                                </details>
                                            </div>
                                        ) : liveDesk.length > 0 ? (
                                            <p className="text-muted-foreground text-sm">
                                                Choose a rate, then enter what
                                                you will pay.
                                            </p>
                                        ) : null}

                                        <takeForm.AppForm>
                                            <takeForm.SubmitButton
                                                labels={[
                                                    values.isOut
                                                        ? "Get tokens"
                                                        : "Get Banx",
                                                    "Sending…",
                                                ]}
                                                loading={
                                                    cashOut.isPending ||
                                                    cashIn.isPending
                                                }
                                                disabled={
                                                    !selected ||
                                                    !values.amount.trim() ||
                                                    payExceedsRemaining
                                                }
                                            />
                                        </takeForm.AppForm>
                                    </>
                                );
                            }}
                        />
                    </form>
                </TabsContent>

                <TabsContent value="desk" className="grid gap-6">
                    <div className="grid gap-6 lg:grid-cols-2">
                        <section className="grid content-start gap-4 rounded-xl border p-4">
                            <div>
                                <h2 className="font-medium">Tokens you hold</h2>
                                <p className="text-muted-foreground mt-1 text-sm">
                                    These pay out when someone gets tokens from
                                    you. Tokens you receive land here too.
                                </p>
                            </div>
                            <form
                                className="grid gap-3"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void fundForm.handleSubmit();
                                }}
                            >
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <fundForm.AppField
                                        name="tokenId"
                                        children={(field) => (
                                            <field.TextField
                                                label="Token"
                                                inputMode="numeric"
                                                placeholder="Id"
                                            />
                                        )}
                                    />
                                    <fundForm.AppField
                                        name="amount"
                                        children={(field) => (
                                            <field.TextField
                                                label="Amount"
                                                inputMode="decimal"
                                            />
                                        )}
                                    />
                                </div>
                                <fundForm.AppForm>
                                    <fundForm.SubmitButton
                                        labels={["Add tokens", "Adding…"]}
                                        loading={fund.isPending}
                                    />
                                </fundForm.AppForm>
                            </form>
                            {vault.length === 0 ? (
                                <p className="text-muted-foreground text-sm">
                                    Nothing held yet.
                                </p>
                            ) : (
                                <ul className="divide-y rounded-lg border">
                                    {vault.map((v) => (
                                        <li
                                            key={v.tokenId}
                                            className="flex items-center justify-between gap-3 px-3 py-2"
                                        >
                                            <span className="font-mono text-sm">
                                                #{v.tokenId}
                                            </span>
                                            <span className="font-mono text-sm">
                                                {displayAmount(v.balance)}
                                            </span>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={withdraw.isPending}
                                                onClick={() =>
                                                    withdraw.mutate({
                                                        tokenId: v.tokenId,
                                                        amount: v.balance,
                                                    })
                                                }
                                            >
                                                Withdraw
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <form
                            className="grid content-start gap-4 rounded-xl border p-4"
                            onSubmit={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void quoteForm.handleSubmit();
                            }}
                        >
                            <div>
                                <h2 className="font-medium">Post a rate</h2>
                                <p className="text-muted-foreground mt-1 text-sm">
                                    What you will trade, and how much is still
                                    open.
                                </p>
                            </div>
                            <quoteForm.Subscribe
                                selector={(s) => s.values}
                                children={(values) => {
                                    const banxSym =
                                        values.assetId !== undefined
                                            ? symbolOf(values.assetId)
                                            : "Banx";
                                    const tokenId = parseTokenId(
                                        values.tokenId,
                                    );
                                    const tokenLabel = tokenName(tokenId);
                                    const payLabel = values.isOut
                                        ? banxSym
                                        : tokenLabel;
                                    const getLabel = values.isOut
                                        ? tokenLabel
                                        : banxSym;
                                    const ratePrecision = values.isOut
                                        ? tokPrec(tokenId)
                                        : assetPrecision(values.assetId);
                                    const ratePending = values.isOut
                                        ? tokenId !== undefined &&
                                          ratePrecision === undefined
                                        : values.assetId !== undefined &&
                                          ratePrecision === undefined;
                                    const rateShown = ratePending
                                        ? "…"
                                        : ratePrecision === undefined
                                          ? values.toRate
                                          : (formatToPrecision(
                                                values.toRate,
                                                ratePrecision,
                                            ) ?? values.toRate);
                                    const ready =
                                        values.assetId !== undefined &&
                                        tokenId !== undefined &&
                                        rateShown.trim() !== "";
                                    const feeOn =
                                        values.feeFixed.trim() !== "" &&
                                        values.feeFixed.trim() !== "0";
                                    const budgetPrec = values.isOut
                                        ? assetPrecision(values.assetId)
                                        : tokPrec(tokenId);
                                    return (
                                        <>
                                            <quoteForm.Field
                                                name="isOut"
                                                children={(field) => (
                                                    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                                                        <button
                                                            type="button"
                                                            className={cn(
                                                                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                                                field.state
                                                                    .value
                                                                    ? "bg-background shadow-sm"
                                                                    : "text-muted-foreground hover:text-foreground",
                                                            )}
                                                            onClick={() =>
                                                                applyDirection(
                                                                    true,
                                                                )
                                                            }
                                                        >
                                                            Sell tokens
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className={cn(
                                                                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                                                !field.state
                                                                    .value
                                                                    ? "bg-background shadow-sm"
                                                                    : "text-muted-foreground hover:text-foreground",
                                                            )}
                                                            onClick={() =>
                                                                applyDirection(
                                                                    false,
                                                                )
                                                            }
                                                        >
                                                            Buy tokens
                                                        </button>
                                                    </div>
                                                )}
                                            />
                                            <quoteForm.Field
                                                name="assetId"
                                                children={(field) => (
                                                    <AssetField
                                                        label="Banx"
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
                                            <quoteForm.AppField
                                                name="tokenId"
                                                children={(field) => (
                                                    <field.TextField
                                                        label="Token"
                                                        inputMode="numeric"
                                                        placeholder="Id"
                                                    />
                                                )}
                                            />
                                            <quoteForm.AppField
                                                name="toRate"
                                                children={(field) => (
                                                    <field.TextField
                                                        label={`${getLabel} per 1 ${payLabel}`}
                                                        inputMode="decimal"
                                                        placeholder="1"
                                                    />
                                                )}
                                            />
                                            <p className="text-muted-foreground text-sm">
                                                {ready ? (
                                                    <>
                                                        They pay 1 {payLabel}{" "}
                                                        and get {rateShown}{" "}
                                                        {getLabel}
                                                        {feeOn
                                                            ? ", before your fee"
                                                            : ""}
                                                        .
                                                    </>
                                                ) : (
                                                    "Choose the Banx asset, the token, and the rate."
                                                )}
                                            </p>
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <quoteForm.AppField
                                                    name="feeFixed"
                                                    children={(field) => (
                                                        <field.TextField
                                                            label="Fee"
                                                            description="Taken from what they pay"
                                                            inputMode="decimal"
                                                            placeholder={
                                                                values.isOut
                                                                    ? values.assetId !==
                                                                      undefined
                                                                        ? amountPlaceholder(
                                                                              assetPrecision(
                                                                                  values.assetId,
                                                                              ) ??
                                                                                  0,
                                                                          )
                                                                        : "0"
                                                                    : amountPlaceholder(
                                                                          tokPrec(
                                                                              tokenId,
                                                                          ) ??
                                                                              0,
                                                                      )
                                                            }
                                                        />
                                                    )}
                                                />
                                                <quoteForm.AppField
                                                    name="remaining"
                                                    validators={
                                                        budgetPrec ===
                                                        undefined
                                                            ? undefined
                                                            : {
                                                                  onChange:
                                                                      amountFieldValidator(
                                                                          budgetPrec,
                                                                          {
                                                                              allowZero:
                                                                                  false,
                                                                          },
                                                                      ),
                                                                  onSubmit:
                                                                      amountFieldValidator(
                                                                          budgetPrec,
                                                                          {
                                                                              allowZero:
                                                                                  false,
                                                                          },
                                                                      ),
                                                              }
                                                    }
                                                    children={(field) => (
                                                        <field.TextField
                                                            label="Open amount"
                                                            description="How much more they can pay"
                                                            inputMode="decimal"
                                                            placeholder={amountPlaceholder(
                                                                budgetPrec ??
                                                                    0,
                                                            )}
                                                        />
                                                    )}
                                                />
                                            </div>
                                        </>
                                    );
                                }}
                            />
                            <quoteForm.Field
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
                            <quoteForm.Subscribe
                                selector={(s) => s.values}
                                children={(values) => (
                                    <quoteForm.AppForm>
                                        <quoteForm.SubmitButton
                                            labels={["Post rate", "Saving…"]}
                                            loading={setQuote.isPending}
                                            disabled={
                                                values.assetId === undefined ||
                                                parseTokenId(values.tokenId) ===
                                                    undefined
                                            }
                                        />
                                    </quoteForm.AppForm>
                                )}
                            />
                        </form>
                    </div>

                    <section className="grid gap-3">
                        <h2 className="font-medium">Your rates</h2>
                        {myQuotes.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                None posted yet.
                            </p>
                        ) : (
                            <QuoteTable
                                quotes={myQuotes}
                                symbolOf={symbolOf}
                                precisionOf={(id) => assetPrecision(id)}
                                tokenPrecision={(id) => tokPrec(id)}
                                onRemove={(q) =>
                                    removeQuote.mutate({
                                        assetId: q.assetId,
                                        tokenId: q.tokenId,
                                        isOut: q.isOut,
                                    })
                                }
                                removing={removeQuote.isPending}
                            />
                        )}
                    </section>
                </TabsContent>
            </Tabs>
        </div>
    );
}

function QuoteTable({
    quotes,
    symbolOf,
    precisionOf,
    tokenPrecision,
    onRemove,
    removing,
}: {
    quotes: CashQuote[];
    symbolOf: (id: number) => string;
    precisionOf: (id: number) => number | undefined;
    tokenPrecision: (id: number) => number | undefined;
    onRemove?: (q: CashQuote) => void;
    removing?: boolean;
}) {
    return (
        <div className="overflow-x-auto rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Trade</TableHead>
                        <TableHead className="text-right">Fee</TableHead>
                        <TableHead className="text-right">Open</TableHead>
                        <TableHead className="text-right">Until</TableHead>
                        {onRemove ? <TableHead /> : null}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {quotes.map((q) => (
                        <TableRow
                            key={`${q.poster}-${q.isOut}-${q.assetId}-${q.tokenId}`}
                        >
                            <TableCell>
                                <div className="font-medium">
                                    {q.isOut ? "You pay tokens" : "You owe Banx"}
                                </div>
                                <div className="text-muted-foreground font-mono text-xs">
                                    {tradeLine(
                                        q,
                                        symbolOf,
                                        precisionOf(q.assetId),
                                        tokenPrecision(q.tokenId),
                                    )}
                                </div>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                                {displayAmount(q.feeFixed)}{" "}
                                <span className="text-muted-foreground">
                                    {q.isOut
                                        ? symbolOf(q.assetId)
                                        : tokenName(q.tokenId)}
                                </span>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                                {displayAmount(q.remaining)}{" "}
                                <span className="text-muted-foreground">
                                    {q.isOut
                                        ? symbolOf(q.assetId)
                                        : tokenName(q.tokenId)}
                                </span>
                            </TableCell>
                            <TableCell className="text-right text-sm">
                                {formatExpiresAt(q.expiresAt)}
                            </TableCell>
                            {onRemove ? (
                                <TableCell className="text-right">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={removing}
                                        onClick={() => onRemove(q)}
                                    >
                                        Remove
                                    </Button>
                                </TableCell>
                            ) : null}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

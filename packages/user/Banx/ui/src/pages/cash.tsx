import { useMemo, useRef, useState } from "react";
import { useStore } from "@tanstack/react-form";
import { ArrowDownUp } from "lucide-react";

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
    formatFxToRate,
    formatToPrecision,
    invertQuotedRate,
} from "@/lib/amount";
import { amountFieldValidator, useAppForm } from "@/lib/form";
import type { CashQuote } from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { toast } from "@shared/shadcn/ui/sonner";
import { Label } from "@shared/shadcn/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@shared/shadcn/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

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
    const liveDesk = deskQuotes.filter((q) => quoteLive(q, nowSec));

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
            if (q.poster !== user && quoteLive(q, nowSec)) names.add(q.poster);
        }
        return [...names].sort();
    }, [allQuotes, user, nowSec]);

    return (
        <div className="space-y-10">
            <PageHeader
                title="Cash"
                description="Tokens stay Tokens. Banx stays claims. A cashier posts a rate; you take it. Out draws Banx on their line and pays you tokens from their vault. In spends your vault and books Banx onto them. Fund the vault before you sell tokens or cash in."
            />

            <section className="grid gap-8 lg:grid-cols-2">
                <form
                    className="grid gap-4 rounded-xl border p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void quoteForm.handleSubmit();
                    }}
                >
                    <div>
                        <h2 className="font-medium">Post quote</h2>
                        <p className="text-muted-foreground mt-1 text-xs">
                            You are the cashier. This is the swap takers see:
                            what they pay, and what they get.
                        </p>
                    </div>
                    <quoteForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) => {
                            const banxSym =
                                values.assetId !== undefined
                                    ? symbolOf(values.assetId)
                                    : "Banx";
                            const tokenLabel = parseTokenId(values.tokenId)
                                ? `Token #${values.tokenId.trim()}`
                                : "Token";
                            const payLabel = values.isOut
                                ? banxSym
                                : tokenLabel;
                            const getLabel = values.isOut
                                ? tokenLabel
                                : banxSym;
                            const tokenId = parseTokenId(values.tokenId);
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
                                                        field.state.value
                                                            ? "bg-background shadow-sm"
                                                            : "text-muted-foreground hover:text-foreground",
                                                    )}
                                                    onClick={() =>
                                                        applyDirection(true)
                                                    }
                                                >
                                                    Banx → Token
                                                </button>
                                                <button
                                                    type="button"
                                                    className={cn(
                                                        "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                                        !field.state.value
                                                            ? "bg-background shadow-sm"
                                                            : "text-muted-foreground hover:text-foreground",
                                                    )}
                                                    onClick={() =>
                                                        applyDirection(false)
                                                    }
                                                >
                                                    Token → Banx
                                                </button>
                                            </div>
                                        )}
                                    />

                                    <div className="relative grid">
                                        <div className="bg-muted/60 space-y-2 rounded-2xl p-3">
                                            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                                                {values.isOut
                                                    ? "Taker owes"
                                                    : "Taker sends"}
                                            </p>
                                            {values.isOut ? (
                                                <quoteForm.Field
                                                    name="assetId"
                                                    children={(field) => (
                                                        <AssetField
                                                            label="Banx asset"
                                                            assets={assets}
                                                            value={
                                                                field.state
                                                                    .value
                                                            }
                                                            onChange={(id) =>
                                                                field.handleChange(
                                                                    id,
                                                                )
                                                            }
                                                        />
                                                    )}
                                                />
                                            ) : (
                                                <quoteForm.AppField
                                                    name="tokenId"
                                                    children={(field) => (
                                                        <field.TextField
                                                            label="Token ID"
                                                            inputMode="numeric"
                                                            placeholder="1"
                                                        />
                                                    )}
                                                />
                                            )}
                                        </div>

                                        <div className="relative z-10 -my-3 flex justify-center">
                                            <Button
                                                type="button"
                                                size="icon"
                                                variant="outline"
                                                className="bg-background size-9 rounded-full border-2"
                                                aria-label="Flip direction"
                                                onClick={() =>
                                                    applyDirection(!values.isOut)
                                                }
                                            >
                                                <ArrowDownUp className="size-4" />
                                            </Button>
                                        </div>

                                        <div className="bg-muted/60 space-y-2 rounded-2xl p-3">
                                            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                                                {values.isOut
                                                    ? "Taker receives"
                                                    : "You owe"}
                                            </p>
                                            {values.isOut ? (
                                                <quoteForm.AppField
                                                    name="tokenId"
                                                    children={(field) => (
                                                        <field.TextField
                                                            label="Token ID"
                                                            inputMode="numeric"
                                                            placeholder="1"
                                                        />
                                                    )}
                                                />
                                            ) : (
                                                <quoteForm.Field
                                                    name="assetId"
                                                    children={(field) => (
                                                        <AssetField
                                                            label="Banx asset"
                                                            assets={assets}
                                                            value={
                                                                field.state
                                                                    .value
                                                            }
                                                            onChange={(id) =>
                                                                field.handleChange(
                                                                    id,
                                                                )
                                                            }
                                                        />
                                                    )}
                                                />
                                            )}
                                            <quoteForm.AppField
                                                name="toRate"
                                                children={(field) => (
                                                    <field.TextField
                                                        label={`Rate · ${getLabel} per 1 ${payLabel}`}
                                                        inputMode="decimal"
                                                        placeholder="0.1"
                                                    />
                                                )}
                                            />
                                        </div>
                                    </div>

                                    <p className="text-muted-foreground text-sm">
                                        {values.assetId !== undefined &&
                                        rateShown ? (
                                            values.isOut ? (
                                                <>
                                                    Takers owe{" "}
                                                    <span className="text-foreground font-medium">
                                                        1 {payLabel}
                                                    </span>{" "}
                                                    and receive{" "}
                                                    <span className="text-foreground font-medium">
                                                        {rateShown} {getLabel}
                                                    </span>{" "}
                                                    from your vault, minus your
                                                    fee.
                                                </>
                                            ) : (
                                                <>
                                                    Takers send{" "}
                                                    <span className="text-foreground font-medium">
                                                        1 {payLabel}
                                                    </span>{" "}
                                                    into your vault and you owe
                                                    them{" "}
                                                    <span className="text-foreground font-medium">
                                                        {rateShown} {getLabel}
                                                    </span>
                                                    , minus your fee.
                                                </>
                                            )
                                        ) : (
                                            <>
                                                Pick both sides and a rate.
                                                Banx → Token: they draw Banx on
                                                your line and you pay tokens
                                                from the vault. Token → Banx:
                                                they send tokens into your
                                                vault and book Banx onto you.
                                            </>
                                        )}
                                    </p>

                                    <quoteForm.AppField
                                        name="feeFixed"
                                        children={(field) => (
                                            <field.TextField
                                                label={`Fee (taken from ${payLabel})`}
                                                inputMode="decimal"
                                                placeholder={
                                                    values.isOut
                                                        ? values.assetId !==
                                                          undefined
                                                            ? amountPlaceholder(
                                                                  assetPrecision(
                                                                      values.assetId,
                                                                  ) ?? 0,
                                                              )
                                                            : "0"
                                                        : amountPlaceholder(
                                                              tokPrec(
                                                                  parseTokenId(
                                                                      values.tokenId,
                                                                  ),
                                                              ) ?? 0,
                                                          )
                                                }
                                            />
                                        )}
                                    />
                                    <quoteForm.AppField
                                        name="remaining"
                                        validators={(() => {
                                            const budgetPrec = values.isOut
                                                ? assetPrecision(
                                                      values.assetId,
                                                  )
                                                : tokPrec(
                                                      parseTokenId(
                                                          values.tokenId,
                                                      ),
                                                  );
                                            if (budgetPrec === undefined) {
                                                return undefined;
                                            }
                                            const validate =
                                                amountFieldValidator(
                                                    budgetPrec,
                                                    { allowZero: false },
                                                );
                                            return {
                                                onChange: validate,
                                                onSubmit: validate,
                                            };
                                        })()}
                                        children={(field) => {
                                            const budgetPrec = values.isOut
                                                ? assetPrecision(
                                                      values.assetId,
                                                  )
                                                : tokPrec(
                                                      parseTokenId(
                                                          values.tokenId,
                                                      ),
                                                  );
                                            return (
                                            <field.TextField
                                                label={`Budget (${payLabel})`}
                                                inputMode="decimal"
                                                placeholder={amountPlaceholder(
                                                    budgetPrec ?? 0,
                                                )}
                                            />
                                            );
                                        }}
                                    />
                                </>
                            );
                        }}
                    />
                    <quoteForm.Field
                        name="expiresAtSeconds"
                        children={(field) => (
                            <ExpiresField
                                value={field.state.value}
                                onChange={(v) => field.handleChange(v)}
                            />
                        )}
                    />
                    <quoteForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) => (
                            <quoteForm.AppForm>
                                <quoteForm.SubmitButton
                                    labels={["Post quote", "Saving…"]}
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

                <div className="grid gap-6">
                    <form
                        className="grid gap-3 rounded-lg border p-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void fundForm.handleSubmit();
                        }}
                    >
                        <h2 className="font-medium">Fund vault</h2>
                        <p className="text-muted-foreground text-xs">
                            Credits Banx then parks tokens in your{" "}
                            <span className="font-mono">
                                {user ?? "you"}/token
                            </span>{" "}
                            sub. Cash-out pays from this; cash-in lands here.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <fundForm.AppField
                                name="tokenId"
                                children={(field) => (
                                    <field.TextField
                                        label="Token ID"
                                        inputMode="numeric"
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
                                labels={["Fund", "Funding…"]}
                                loading={fund.isPending}
                            />
                        </fundForm.AppForm>
                    </form>

                    <div className="space-y-2">
                        <h2 className="font-medium">Your vault</h2>
                        {vault.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                Empty. Fund a Token ID to stock a Banx → Token
                                quote.
                            </p>
                        ) : (
                            <div className="overflow-x-auto rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Token</TableHead>
                                            <TableHead className="text-right">
                                                Balance
                                            </TableHead>
                                            <TableHead />
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {vault.map((v) => (
                                            <TableRow key={v.tokenId}>
                                                <TableCell className="font-mono">
                                                    #{v.tokenId}
                                                </TableCell>
                                                <TableCell className="text-right font-mono">
                                                    {displayAmount(v.balance)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={
                                                            withdraw.isPending
                                                        }
                                                        onClick={() =>
                                                            withdraw.mutate({
                                                                tokenId: v.tokenId,
                                                                amount: v.balance,
                                                            })
                                                        }
                                                    >
                                                        Withdraw
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <section className="space-y-3">
                <h2 className="font-medium">Your quotes</h2>
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

            <section className="grid max-w-xl gap-3 rounded-lg border p-4">
                <h2 className="font-medium">Take a quote</h2>
                <p className="text-muted-foreground text-xs">
                    Out draws on the cashier’s line to you. In spends your
                    vault — fund first if it’s empty. Cash-in tokens stay in
                    their vault.
                </p>
                {desks.length > 0 ? (
                    <p className="text-muted-foreground text-xs">
                        Live desks: {desks.join(", ")}
                    </p>
                ) : null}
                <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void takeForm.handleSubmit();
                    }}
                >
                    <div className="grid gap-2">
                        <Label htmlFor="cashier">Cashier</Label>
                        <input
                            id="cashier"
                            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                            value={takeCashier}
                            onChange={(e) => setTakeCashier(e.target.value)}
                            placeholder="james"
                        />
                    </div>
                    {liveDesk.length > 0 ? (
                        <ul className="text-muted-foreground space-y-1 text-xs">
                            {liveDesk.map((q) => (
                                <li key={`${q.isOut}-${q.assetId}-${q.tokenId}`}>
                                    <button
                                        type="button"
                                        className="hover:text-foreground underline-offset-2 hover:underline"
                                        onClick={() => {
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
                                                String(q.tokenId),
                                            );
                                        }}
                                    >
                                        {q.isOut
                                            ? "Banx → Token"
                                            : "Token → Banx"}{" "}
                                        {symbolOf(q.assetId)} ↔ #{q.tokenId}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : cashier ? (
                        <p className="text-muted-foreground text-xs">
                            No live quotes from {cashier}.
                        </p>
                    ) : null}
                    <takeForm.Field
                        name="isOut"
                        children={(field) => (
                            <div className="grid gap-2">
                                <Label>Take</Label>
                                <Select
                                    value={field.state.value ? "out" : "in"}
                                    onValueChange={(v) =>
                                        field.handleChange(v === "out")
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="out">
                                            Banx → Token (draw Banx, receive
                                            tokens)
                                        </SelectItem>
                                        <SelectItem value="in">
                                            Token → Banx (send tokens, book
                                            Banx)
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                        <takeForm.Field
                            name="assetId"
                            children={(field) => (
                                <AssetField
                                    label="Banx asset"
                                    assets={assets}
                                    value={field.state.value}
                                    onChange={(id) => field.handleChange(id)}
                                />
                            )}
                        />
                        <takeForm.AppField
                            name="tokenId"
                            children={(field) => (
                                <field.TextField
                                    label="Token ID"
                                    inputMode="numeric"
                                />
                            )}
                        />
                    </div>
                    <takeForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) => {
                            const tokenId = parseTokenId(values.tokenId);
                            const q = liveDesk.find(
                                (x) =>
                                    x.isOut === values.isOut &&
                                    x.assetId === values.assetId &&
                                    x.tokenId === tokenId,
                            );
                            const fromPrec = values.isOut
                                ? assetPrecision(values.assetId)
                                : tokPrec(tokenId);
                            const toPrec = values.isOut
                                ? tokPrec(tokenId)
                                : assetPrecision(values.assetId);
                            const quoted =
                                q &&
                                values.amount.trim() &&
                                fromPrec !== undefined &&
                                toPrec !== undefined
                                    ? applyQuotedRate(
                                          values.amount,
                                          q.feeFixed,
                                          q.fxRate,
                                          fromPrec,
                                          toPrec,
                                      )
                                    : null;
                            return (
                                <>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <takeForm.AppField
                                            name="amount"
                                            children={(field) => (
                                                <field.TextField
                                                    label={
                                                        values.isOut
                                                            ? `Spend (${values.assetId !== undefined ? symbolOf(values.assetId) : "Banx"})`
                                                            : "Spend (token)"
                                                    }
                                                    inputMode="decimal"
                                                />
                                            )}
                                        />
                                        <takeForm.AppField
                                            name="minOut"
                                            children={(field) => (
                                                <field.TextField
                                                    label={
                                                        values.isOut
                                                            ? "Min tokens"
                                                            : `Min ${values.assetId !== undefined ? symbolOf(values.assetId) : "Banx"}`
                                                    }
                                                    inputMode="decimal"
                                                    placeholder={quoted ?? "0"}
                                                />
                                            )}
                                        />
                                    </div>
                                    {q ? (
                                        <p className="text-muted-foreground font-mono text-xs">
                                            Quote{" "}
                                            {fromPrec === undefined ||
                                            toPrec === undefined
                                                ? "…"
                                                : values.isOut
                                                  ? `1 ${symbolOf(q.assetId)} → ${formatFxToRate(q.fxRate, fromPrec, toPrec)} token`
                                                  : `1 token → ${formatFxToRate(q.fxRate, fromPrec, toPrec)} ${symbolOf(q.assetId)}`}
                                            {quoted
                                                ? ` · this size → ${quoted}`
                                                : ""}
                                            {` · left ${displayAmount(q.remaining)}`}
                                        </p>
                                    ) : null}
                                </>
                            );
                        }}
                    />
                    <takeForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) => (
                            <takeForm.AppForm>
                                <takeForm.SubmitButton
                                    labels={[
                                        values.isOut ? "Cash out" : "Cash in",
                                        "Sending…",
                                    ]}
                                    loading={
                                        cashOut.isPending || cashIn.isPending
                                    }
                                    disabled={
                                        !cashier ||
                                        values.assetId === undefined ||
                                        parseTokenId(values.tokenId) ===
                                            undefined
                                    }
                                />
                            </takeForm.AppForm>
                        )}
                    />
                </form>
            </section>
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
                        <TableHead>Side</TableHead>
                        <TableHead>Banx</TableHead>
                        <TableHead>Token</TableHead>
                        <TableHead className="text-right">Fee</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead className="text-right">Left</TableHead>
                        <TableHead className="text-right">Expires</TableHead>
                        {onRemove ? <TableHead /> : null}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {quotes.map((q) => (
                        <TableRow
                            key={`${q.poster}-${q.isOut}-${q.assetId}-${q.tokenId}`}
                        >
                            <TableCell>
                                {q.isOut ? "Banx → Token" : "Token → Banx"}
                            </TableCell>
                            <TableCell>{symbolOf(q.assetId)}</TableCell>
                            <TableCell className="font-mono">
                                #{q.tokenId}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                                {displayAmount(q.feeFixed)}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                                {(() => {
                                    const assetP = precisionOf(q.assetId);
                                    const tokenP = tokenPrecision(q.tokenId);
                                    if (
                                        assetP === undefined ||
                                        tokenP === undefined
                                    ) {
                                        return "…";
                                    }
                                    return q.isOut
                                        ? `1 ${symbolOf(q.assetId)} → ${formatFxToRate(q.fxRate, assetP, tokenP)} tok`
                                        : `1 tok → ${formatFxToRate(q.fxRate, tokenP, assetP)} ${symbolOf(q.assetId)}`;
                                })()}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                                {displayAmount(q.remaining)}
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

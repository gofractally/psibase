import { useMemo, useRef, useState } from "react";
import { useStore } from "@tanstack/react-form";

import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import {
    useCashQuotes,
    useCashVault,
    useTokenPrecisionMap,
} from "@/hooks/use-favor-data";
import {
    useCashFund,
    useCashIn,
    useCashOut,
    useCashWithdraw,
} from "@/hooks/use-favor-mutations";
import {
    applyQuotedRate,
    displayAmount,
    humanToRaw,
    formatFxToRate,
} from "@/lib/amount";
import { useAppForm } from "@/lib/form";
import type { CashQuote } from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { toast } from "@shared/shadcn/ui/sonner";
import { Label } from "@shared/shadcn/ui/label";

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
    const favor = symbolOf(q.assetId);
    const token = tokenName(q.tokenId);
    return q.isOut
        ? `1 ${favor} → ${formatFxToRate(q.fxRate, assetPrecision, tokenPrecision)} ${token}`
        : `1 ${token} → ${formatFxToRate(q.fxRate, tokenPrecision, assetPrecision)} ${favor}`;
}

export function CashPage() {
    const { data: user } = useCurrentUser();
    const { byId, symbolOf, precisionOf } = useAssetMap();
    const takeCtxRef = useRef({
        liveDesk: [] as CashQuote[],
        tokenPrecision: new Map<number, number>(),
        tokenPending: new Set<number>() as ReadonlySet<number>,
        tokenFailed: new Set<number>() as ReadonlySet<number>,
        assetPrecision: (_id: number): number | undefined => undefined,
        cashier: "",
    });
    const { data: allQuotes = [] } = useCashQuotes();
    const { data: vault = [] } = useCashVault();
    const fund = useCashFund();
    const withdraw = useCashWithdraw();
    const cashOut = useCashOut();
    const cashIn = useCashIn();
    const nowSec = Math.floor(Date.now() / 1000);

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
                            amountFavor: value.amount.trim(),
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
                            minFavor: minOut,
                        },
                        opts,
                    );
                }
            });
        },
    });

    const takeTokenRaw = useStore(takeForm.store, (s) => s.values.tokenId);
    const editingTokenIds = [takeTokenRaw].flatMap((raw) => {
        const id = parseTokenId(raw);
        return id === undefined ? [] : [id];
    });
    const {
        precision: tokenPrec,
        pending: tokenPending,
        failed: tokenFailed,
    } = useTokenPrecisionMap([
        ...deskQuotes.map((q) => q.tokenId),
        ...vault.map((v) => v.tokenId),
        ...editingTokenIds,
    ]);
    const assetPrecision = (id: number | undefined): number | undefined =>
        id !== undefined && byId.has(id) ? precisionOf(id) : undefined;
    const tokPrec = (id: number | undefined): number | undefined =>
        id !== undefined ? tokenPrec.get(id) : undefined;
    takeCtxRef.current = {
        liveDesk,
        tokenPrecision: tokenPrec,
        tokenPending,
        tokenFailed,
        assetPrecision: (id) => assetPrecision(id),
        cashier,
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
                description="Sell tokens for an IOU, or buy tokens by owing an IOU."
            />

                    <form
                        className="mx-auto grid w-full max-w-md gap-4 rounded-xl border p-4"
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
                        {!cashier && desks.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                No rates are posted yet. Someone posts an
                                order on Trade, then you can swap here.
                            </p>
                        ) : !cashier ? (
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
                                                                <span>
                                                                    <span className="block font-medium">
                                                                        Pay{" "}
                                                                        {q.isOut
                                                                            ? symbolOf(
                                                                                  q.assetId,
                                                                              )
                                                                            : tokenName(
                                                                                  q.tokenId,
                                                                              )}
                                                                    </span>
                                                                    <span className="text-muted-foreground block text-sm">
                                                                        {q.isOut
                                                                            ? `Get ${tokenName(q.tokenId)}`
                                                                            : `Get ${symbolOf(q.assetId)} owed to you`}
                                                                    </span>
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
                                                                    still open
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
                                                        own vault. Add them
                                                        below.
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
                                                    selected
                                                        ? `Pay ${payUnit}`
                                                        : "Choose a rate",
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
                        <section className="grid content-start gap-4 rounded-xl border p-4">
                            <div>
                                <h2 className="font-medium">Tokens you hold</h2>
                                <p className="text-muted-foreground mt-1 text-sm">
                                    Tokens you sell come out of here. Tokens
                                    you buy are added here.
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
                                                label="Token number"
                                                inputMode="numeric"
                                                placeholder="Token number"
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
                                                Token {v.tokenId}
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

        </div>
    );
}

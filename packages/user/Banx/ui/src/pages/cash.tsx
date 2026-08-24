import { useMemo, useState } from "react";

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
    displayAmount,
    formatFxToRate,
    formatToPrecision,
} from "@/lib/amount";
import { useAppForm } from "@/lib/form";
import type { CashQuote } from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
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

export function CashPage() {
    const { data: user } = useCurrentUser();
    const { assets, symbolOf, precisionOf } = useAssetMap();
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
            expiresAtSeconds: 0,
        },
        onSubmit: async ({ value }) => {
            const tokenId = parseTokenId(value.tokenId);
            if (value.assetId === undefined || tokenId === undefined) return;
            await new Promise<void>((resolve, reject) => {
                setQuote.mutate(
                    {
                        assetId: value.assetId!,
                        tokenId,
                        isOut: value.isOut,
                        feeFixed: value.feeFixed.trim(),
                        toRate: value.toRate.trim(),
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
            const tokenId = parseTokenId(value.tokenId);
            if (!cashier || value.assetId === undefined || tokenId === undefined)
                return;
            await new Promise<void>((resolve, reject) => {
                const opts = {
                    onSuccess: () => resolve(),
                    onError: (e: Error) => reject(e),
                };
                if (value.isOut) {
                    cashOut.mutate(
                        {
                            cashier,
                            assetId: value.assetId!,
                            tokenId,
                            amountBanx: value.amount.trim(),
                            minTokens: value.minOut.trim() || "0",
                        },
                        opts,
                    );
                } else {
                    cashIn.mutate(
                        {
                            cashier,
                            assetId: value.assetId!,
                            tokenId,
                            amountTokens: value.amount.trim(),
                            minBanx: value.minOut.trim() || "0",
                        },
                        opts,
                    );
                }
            });
        },
    });

    const tokenPrec = useTokenPrecisionMap([
        ...myQuotes.map((q) => q.tokenId),
        ...deskQuotes.map((q) => q.tokenId),
        ...vault.map((v) => v.tokenId),
    ]);
    const tokPrec = (id: number | undefined) =>
        id !== undefined ? (tokenPrec.get(id) ?? 4) : 4;

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
                    className="grid gap-3 rounded-lg border p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void quoteForm.handleSubmit();
                    }}
                >
                    <h2 className="font-medium">Post quote</h2>
                    <p className="text-muted-foreground text-xs">
                        Rate is to-units per 1 from-unit. Out: tokens per 1
                        Banx. In: Banx per 1 token. Fair reverse of 0.1 tokens
                        per Banx is 10 Banx per token — post in a bit worse if
                        you want a spread.
                    </p>
                    <quoteForm.Subscribe
                        selector={(s) => s.values.isOut}
                        children={(isOut) => (
                            <quoteForm.Field
                                name="isOut"
                                children={(field) => (
                                    <div className="grid gap-2">
                                        <Label>Side</Label>
                                        <Select
                                            value={isOut ? "out" : "in"}
                                            onValueChange={(v) =>
                                                field.handleChange(v === "out")
                                            }
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="out">
                                                    Out — sell tokens for Banx
                                                </SelectItem>
                                                <SelectItem value="in">
                                                    In — buy tokens for Banx
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            />
                        )}
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                        <quoteForm.Field
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
                        <quoteForm.AppField
                            name="tokenId"
                            children={(field) => (
                                <field.TextField
                                    label="Token id"
                                    inputMode="numeric"
                                    placeholder="1"
                                />
                            )}
                        />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <quoteForm.Subscribe
                            selector={(s) => s.values}
                            children={(values) => (
                                <quoteForm.AppField
                                    name="feeFixed"
                                    children={(field) => (
                                        <field.TextField
                                            label={
                                                values.isOut
                                                    ? `Fee (${values.assetId !== undefined ? symbolOf(values.assetId) : "Banx"})`
                                                    : "Fee (token)"
                                            }
                                            inputMode="decimal"
                                            placeholder={
                                                values.isOut &&
                                                values.assetId !== undefined
                                                    ? amountPlaceholder(
                                                          precisionOf(
                                                              values.assetId,
                                                          ),
                                                      )
                                                    : "0"
                                            }
                                        />
                                    )}
                                />
                            )}
                        />
                        <quoteForm.Subscribe
                            selector={(s) => s.values}
                            children={(values) => (
                                <div className="grid gap-2">
                                    <quoteForm.AppField
                                        name="toRate"
                                        children={(field) => (
                                            <field.TextField
                                                label="Rate (to per 1 from)"
                                                inputMode="decimal"
                                                placeholder="0.1"
                                            />
                                        )}
                                    />
                                    {values.assetId !== undefined ? (
                                        <p className="text-muted-foreground font-mono text-xs">
                                            {values.isOut
                                                ? `1 ${symbolOf(values.assetId)} → ${(formatToPrecision(values.toRate, tokPrec(parseTokenId(values.tokenId))) ?? values.toRate) || "?"} token`
                                                : `1 token → ${(formatToPrecision(values.toRate, precisionOf(values.assetId)) ?? values.toRate) || "?"} ${symbolOf(values.assetId)}`}
                                        </p>
                                    ) : null}
                                </div>
                            )}
                        />
                    </div>
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
                                    labels={["Save quote", "Saving…"]}
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
                                        label="Token id"
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
                                Empty. Fund a token id to stock an out quote.
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
                        precisionOf={precisionOf}
                        tokenPrecision={tokPrec}
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
                                        {q.isOut ? "Out" : "In"}{" "}
                                        {symbolOf(q.assetId)} ↔ token #
                                        {q.tokenId}
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
                                            Out — draw Banx, receive tokens
                                        </SelectItem>
                                        <SelectItem value="in">
                                            In — send tokens, book Banx
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
                                    label="Token id"
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
                                ? values.assetId !== undefined
                                    ? precisionOf(values.assetId)
                                    : 0
                                : tokPrec(tokenId);
                            const toPrec = values.isOut
                                ? tokPrec(tokenId)
                                : values.assetId !== undefined
                                  ? precisionOf(values.assetId)
                                  : 0;
                            const quoted =
                                q && values.amount.trim()
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
                                            {values.isOut
                                                ? `1 ${symbolOf(q.assetId)} → ${formatFxToRate(q.fxRate, precisionOf(q.assetId), tokPrec(q.tokenId))} token`
                                                : `1 token → ${formatFxToRate(q.fxRate, tokPrec(q.tokenId), precisionOf(q.assetId))} ${symbolOf(q.assetId)}`}
                                            {quoted
                                                ? ` · this size → ${quoted}`
                                                : ""}
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
    precisionOf: (id: number) => number;
    tokenPrecision: (id: number) => number;
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
                        <TableHead className="text-right">Expires</TableHead>
                        {onRemove ? <TableHead /> : null}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {quotes.map((q) => (
                        <TableRow
                            key={`${q.poster}-${q.isOut}-${q.assetId}-${q.tokenId}`}
                        >
                            <TableCell>{q.isOut ? "Out" : "In"}</TableCell>
                            <TableCell>{symbolOf(q.assetId)}</TableCell>
                            <TableCell className="font-mono">
                                #{q.tokenId}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                                {displayAmount(q.feeFixed)}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                                {q.isOut
                                    ? `1 ${symbolOf(q.assetId)} → ${formatFxToRate(q.fxRate, precisionOf(q.assetId), tokenPrecision(q.tokenId))} tok`
                                    : `1 tok → ${formatFxToRate(q.fxRate, tokenPrecision(q.tokenId), precisionOf(q.assetId))} ${symbolOf(q.assetId)}`}
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

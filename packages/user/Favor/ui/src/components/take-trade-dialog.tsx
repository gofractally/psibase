import { useEffect, useRef } from "react";

import { useAssetMap } from "@/hooks/use-assets";
import {
    useObligations,
    useTokenPrecisionMap,
} from "@/hooks/use-favor-data";
import {
    useCashIn,
    useCashOut,
    useTakeFx,
} from "@/hooks/use-favor-mutations";
import {
    amountPlaceholder,
    applyQuotedRate,
    formatRawAmount,
    humanToRaw,
    rawToFixed,
} from "@/lib/amount";
import { amountFieldValidator, useAppForm } from "@/lib/form";
import type {
    CashQuote,
    FxOffer,
    Obligation,
} from "@/lib/graphql";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { toast } from "@shared/shadcn/ui/sonner";

export type TakeTrade =
    | { kind: "policy"; policy: FxOffer }
    | { kind: "cash"; quote: CashQuote };

/** Sum of `creditor`'s live claim on `debtor` in one asset. */
export function directedDebt(
    rows: Obligation[],
    creditor: string,
    debtor: string,
    assetId: number,
    precision: number,
): bigint {
    let sum = 0n;
    for (const row of rows) {
        if (
            row.creditor !== creditor ||
            row.debtor !== debtor ||
            row.assetId !== assetId
        ) {
            continue;
        }
        sum += humanToRaw(row.amount || "0", precision);
    }
    return sum;
}

function quotedRaw(
    amount: string,
    fee: string,
    fxRate: string,
    fromPrec: number,
    toPrec: number,
    addFee = false,
): bigint | null {
    const shown = applyQuotedRate(
        amount,
        fee,
        fxRate,
        fromPrec,
        toPrec,
        addFee,
    );
    if (!shown) return null;
    const raw = humanToRaw(shown, toPrec);
    return raw > 0n ? raw : null;
}

/**
 * Signed to-asset of a buy. Old debt is rebooked (fee on top, a debt).
 * The rest is a new claim (fee off, a receipt). Positive means the taker
 * receives. Negative means they owe. Null when either slice cannot price.
 */
function buyNetRaw(
    amount: string,
    owedRaw: bigint,
    fee: string,
    fxRate: string,
    fromPrec: number,
    toPrec: number,
): bigint | null {
    const clicked = humanToRaw(amount, fromPrec);
    if (clicked <= 0n) return null;
    const rebook = clicked < owedRaw ? clicked : owedRaw;
    const open = clicked - rebook;
    const rebookTo =
        rebook > 0n
            ? quotedRaw(
                  rawToFixed(rebook, fromPrec),
                  fee,
                  fxRate,
                  fromPrec,
                  toPrec,
                  true,
              )
            : 0n;
    const openTo =
        open > 0n
            ? quotedRaw(
                  rawToFixed(open, fromPrec),
                  fee,
                  fxRate,
                  fromPrec,
                  toPrec,
                  false,
              )
            : 0n;
    if (rebookTo === null || openTo === null) return null;
    return openTo - rebookTo;
}

export function TakeTradeDialog({
    trade,
    taker,
    poster,
    display,
    onOpenChange,
}: {
    trade: TakeTrade | null;
    taker: string;
    poster: string;
    display: string;
    onOpenChange: (open: boolean) => void;
}) {
    const { byId, symbolOf, precisionOf } = useAssetMap();
    const cashOut = useCashOut();
    const cashIn = useCashIn();
    const takeFx = useTakeFx();
    const policy = trade?.kind === "policy" ? trade.policy : null;
    const quote = trade?.kind === "cash" ? trade.quote : null;
    const buying = policy?.posterIsCreditor === true;
    const selling = policy?.posterIsCreditor === false;
    const {
        data: obligations = [],
        isLoading: obligationsLoading,
        isError: obligationsError,
    } = useObligations();
    const tokenId = quote?.tokenId ?? 0;
    const { precision: tokenPrecisions, failed: tokenFailures } =
        useTokenPrecisionMap([tokenId]);
    const tokenPrec = tokenId > 0 ? tokenPrecisions.get(tokenId) : undefined;
    const tokenFailed = tokenId > 0 && tokenFailures.has(tokenId);
    const nowSec = Math.floor(Date.now() / 1000);
    const assetPrec = (id: number): number | undefined =>
        byId.has(id) ? precisionOf(id) : undefined;

    const fromPrec = policy
        ? assetPrec(policy.fromAsset)
        : quote?.isOut
          ? assetPrec(quote.assetId)
          : tokenPrec;
    const toPrec = policy
        ? assetPrec(policy.toAsset)
        : quote?.isOut
          ? tokenPrec
          : quote
            ? assetPrec(quote.assetId)
            : undefined;

    const remainingRaw =
        policy && fromPrec !== undefined
            ? humanToRaw(policy.remaining || "0", fromPrec)
            : quote && fromPrec !== undefined
              ? humanToRaw(quote.remaining || "0", fromPrec)
              : 0n;
    const claimRaw =
        selling && policy && fromPrec !== undefined
            ? directedDebt(obligations, taker, poster, policy.fromAsset, fromPrec)
            : null;
    // Debt already in this book is rebooked. The rest of the click opens
    // both legs. The cap is the order, not the old bill.
    const owedByTaker =
        buying && policy && fromPrec !== undefined
            ? directedDebt(
                  obligations,
                  poster,
                  taker,
                  policy.fromAsset,
                  fromPrec,
              )
            : 0n;
    const debtReady = !obligationsLoading && !obligationsError;
    const immediate = buying && debtReady && owedByTaker > 0n;
    const directCap = selling ? claimRaw : null;
    const capRaw =
        directCap === null
            ? remainingRaw
            : directCap < remainingRaw
              ? directCap
              : remainingRaw;

    const expired =
        (!!policy && policy.expiresAt !== 0 && policy.expiresAt < nowSec) ||
        (!!quote && quote.expiresAt !== 0 && quote.expiresAt < nowSec);

    const fromSymbol = policy
        ? symbolOf(policy.fromAsset)
        : quote?.isOut
          ? symbolOf(quote.assetId)
          : quote
            ? `#${quote.tokenId}`
            : "";
    const toSymbol = policy
        ? symbolOf(policy.toAsset)
        : quote?.isOut
          ? `#${quote.tokenId}`
          : quote
            ? symbolOf(quote.assetId)
            : "";

    const missingPrecision = fromPrec === undefined || toPrec === undefined;
    let description = "Take this order.";
    if (missingPrecision) {
        description = tokenFailed
            ? "Couldn't load this token's precision."
            : "Loading this order.";
    } else if (expired) {
        description = "This order has expired.";
    } else if (policy && buying && obligationsError) {
        description = "Couldn't load what you already owe them.";
    } else if (policy && buying && obligationsLoading) {
        description = "Checking what you already owe them.";
    } else if (policy && buying && immediate) {
        description = `${fromSymbol} you already owe ${display} is rebooked at their price. Anything past that is a new ${fromSymbol} debt.`;
    } else if (policy && buying) {
        description = `You owe ${display} the ${fromSymbol} you take, and they owe you ${toSymbol}, both at their order rate. This needs a ${fromSymbol} line from them and a ${toSymbol} line from you.`;
    } else if (policy && selling && obligationsError) {
        description = "Couldn't load what they owe you.";
    } else if (policy && selling && obligationsLoading) {
        description = "Checking what they already owe you.";
    } else if (policy && selling && claimRaw === 0n) {
        description = `${display} does not owe you ${fromSymbol}. A sell only rebooks a debt they already owe you.`;
    } else if (policy && selling) {
        description = `This rebooks ${fromSymbol} ${display} already owes you into ${toSymbol} at their price.`;
    } else if (quote?.isOut) {
        description = `You owe ${display} ${fromSymbol} and receive ${toSymbol} from their vault.`;
    } else if (quote) {
        description = `You pay ${fromSymbol} from your vault. ${display} owes you ${toSymbol}. The tokens have to be in your vault first.`;
    }

    const submitRef = useRef<() => Promise<void>>(async () => {});
    const form = useAppForm({
        defaultValues: { amount: "" },
        onSubmit: async () => {
            await submitRef.current();
        },
    });

    const tradeKey = policy
        ? `p-${policy.fromAsset}-${policy.toAsset}-${policy.posterIsCreditor ? 1 : 0}`
        : quote
          ? `c-${quote.isOut ? 1 : 0}-${quote.assetId}-${quote.tokenId}`
          : "";
    useEffect(() => {
        form.reset({ amount: "" });
        // A new order should not keep the previous amount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tradeKey]);

    submitRef.current = async () => {
        const amount = String(form.state.values.amount ?? "").trim();
        if (!amount || fromPrec === undefined || toPrec === undefined) return;
        if (policy) {
            // Existing from-debt adds the fee onto what the debtor will owe.
            // A new book and a sell subtract it from what the taker receives.
            // A buy that does both signs the net of the two.
            const received = buying
                ? buyNetRaw(
                      amount,
                      owedByTaker,
                      policy.feeFixed,
                      policy.fxRate,
                      fromPrec,
                      toPrec,
                  )
                : quotedRaw(
                      amount,
                      policy.feeFixed,
                      policy.fxRate,
                      fromPrec,
                      toPrec,
                      false,
                  );
            if (received === null) {
                toast.error("That amount is too small at their rate.");
                return;
            }
            await new Promise<void>((resolve, reject) => {
                takeFx.mutate(
                    {
                        poster,
                        fromAsset: policy.fromAsset,
                        toAsset: policy.toAsset,
                        posterIsCreditor: policy.posterIsCreditor,
                        amountFrom: amount,
                        toBound: rawToFixed(received, toPrec),
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
            return;
        }
        if (quote && fromPrec !== undefined && toPrec !== undefined) {
            const received = quotedRaw(
                amount,
                quote.feeFixed,
                quote.fxRate,
                fromPrec,
                toPrec,
            );
            if (!received) {
                toast.error("That amount is too small at their rate.");
                return;
            }
            const minOut = rawToFixed(received, toPrec);
            await new Promise<void>((resolve, reject) => {
                const done = {
                    onSuccess: () => {
                        onOpenChange(false);
                        resolve();
                    },
                    onError: (e: Error) => reject(e),
                };
                if (quote.isOut) {
                    cashOut.mutate(
                        {
                            cashier: poster,
                            assetId: quote.assetId,
                            tokenId: quote.tokenId,
                            amountFavor: amount,
                            minTokens: minOut,
                        },
                        done,
                    );
                } else {
                    cashIn.mutate(
                        {
                            cashier: poster,
                            assetId: quote.assetId,
                            tokenId: quote.tokenId,
                            amountTokens: amount,
                            minFavor: minOut,
                        },
                        done,
                    );
                }
            });
        }
    };

    const nothingLeft =
        !missingPrecision &&
        !expired &&
        capRaw === 0n &&
        !(selling && (obligationsLoading || obligationsError || claimRaw === 0n)) &&
        !(buying && (obligationsLoading || obligationsError));
    const blocked =
        (buying && (obligationsLoading || obligationsError)) ||
        expired ||
        nothingLeft ||
        (selling &&
            (obligationsLoading || obligationsError || claimRaw === 0n)) ||
        missingPrecision;
    if (nothingLeft) {
        description = "Nothing is left on this order.";
    }
    const capHuman =
        fromPrec === undefined
            ? ""
            : formatRawAmount(capRaw.toString(), fromPrec);
    const pending =
        cashOut.isPending || cashIn.isPending || takeFx.isPending;

    return (
        <Dialog open={trade !== null} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {policy && selling ? "Rebook" : "Take trade"}
                    </DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                {blocked ||
                fromPrec === undefined ||
                toPrec === undefined ? (
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Close
                        </Button>
                    </DialogFooter>
                ) : (
                    <form
                        className="grid gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void form.handleSubmit();
                        }}
                    >
                        <form.AppField
                            name="amount"
                            validators={{
                                onChange: ({ value }) => {
                                    const base = amountFieldValidator(
                                        fromPrec,
                                        { allowZero: false },
                                    )({ value });
                                    if (base) return base;
                                    if (
                                        humanToRaw(String(value), fromPrec) >
                                        capRaw
                                    ) {
                                        return `Cannot exceed ${capHuman} ${fromSymbol}`;
                                    }
                                    return undefined;
                                },
                                onSubmit: ({ value }) => {
                                    const base = amountFieldValidator(
                                        fromPrec,
                                        { allowZero: false },
                                    )({ value });
                                    if (base) return base;
                                    if (
                                        humanToRaw(String(value), fromPrec) >
                                        capRaw
                                    ) {
                                        return `Cannot exceed ${capHuman} ${fromSymbol}`;
                                    }
                                    return undefined;
                                },
                            }}
                            children={(field) => (
                                <field.TextField
                                    label={`Amount (${fromSymbol})`}
                                    description={
                                        policy && immediate
                                            ? `Up to ${capHuman} ${fromSymbol}. What you already owe is rebooked. The rest is a new trade.`
                                            : policy && selling
                                              ? `Up to ${capHuman} ${fromSymbol}. This becomes ${toSymbol} debt, same direction.`
                                              : policy
                                                ? `Up to ${capHuman} ${fromSymbol}. You will owe them that, and they will owe you ${toSymbol}.`
                                                : `Up to ${capHuman} ${fromSymbol}.`
                                    }
                                    inputMode="decimal"
                                    required
                                    placeholder={amountPlaceholder(fromPrec)}
                                />
                            )}
                        />
                        <form.Subscribe
                            selector={(s) => s.values.amount}
                            children={(amount) => {
                                const net = policy
                                    ? buying
                                        ? buyNetRaw(
                                              String(amount ?? ""),
                                              owedByTaker,
                                              policy.feeFixed,
                                              policy.fxRate,
                                              fromPrec,
                                              toPrec,
                                          )
                                        : quotedRaw(
                                              String(amount ?? ""),
                                              policy.feeFixed,
                                              policy.fxRate,
                                              fromPrec,
                                              toPrec,
                                              false,
                                          )
                                    : quote
                                      ? quotedRaw(
                                            String(amount ?? ""),
                                            quote.feeFixed,
                                            quote.fxRate,
                                            fromPrec,
                                            toPrec,
                                        )
                                      : null;
                                const shown =
                                    net === null
                                        ? "—"
                                        : formatRawAmount(
                                              (net < 0n ? -net : net).toString(),
                                              toPrec,
                                          );
                                const oweNet = net !== null && net < 0n;
                                const line =
                                    net === null
                                        ? shown
                                        : oweNet
                                          ? `You will owe ${shown} ${toSymbol}.`
                                          : selling
                                            ? `You will be owed ${shown} ${toSymbol}.`
                                            : `You receive ${shown} ${toSymbol}.`;
                                return (
                                    <p className="text-muted-foreground text-sm">
                                        {line}
                                    </p>
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
                            <form.AppForm>
                                <form.SubmitButton
                                    labels={[
                                        "Take trade",
                                        "Taking…",
                                    ]}
                                    loading={pending}
                                />
                            </form.AppForm>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}

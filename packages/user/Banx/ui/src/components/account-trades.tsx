import { useState } from "react";

import { formatExpiresAt } from "@/components/expires-at-picker";
import {
    directedDebt,
    TakeTradeDialog,
    type TakeTrade,
} from "@/components/take-trade-dialog";
import { useAssetMap } from "@/hooks/use-assets";
import {
    useCashQuotes,
    useObligations,
    usePosterFxOffers,
    useTokenPrecisionMap,
} from "@/hooks/use-banx-data";
import { displayAmount, formatFxToRate } from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

/** Orders posted by this account, so another person can find them. */
export function AccountTrades({
    account,
    display,
}: {
    account: string;
    display: string;
}) {
    const { data: user } = useCurrentUser();
    const taker = user ?? "";
    const canTake =
        taker !== "" && taker.toLowerCase() !== account.trim().toLowerCase();
    const [take, setTake] = useState<TakeTrade | null>(null);
    const { byId, symbolOf, precisionOf } = useAssetMap();
    const {
        data: policies = [],
        isLoading: policiesLoading,
        isError: policiesError,
    } = usePosterFxOffers(account);
    const {
        data: quotes = [],
        isLoading: quotesLoading,
        isError: quotesError,
    } = useCashQuotes(account);
    const { data: obligations = [] } = useObligations();
    const tokenPrecisions = useTokenPrecisionMap(quotes.map((q) => q.tokenId));
    const convertsDebt = (fromAsset: number, posterIsCreditor: boolean) => {
        if (!posterIsCreditor) return true;
        if (!canTake || !byId.has(fromAsset)) return false;
        return (
            directedDebt(
                obligations,
                account,
                taker,
                fromAsset,
                precisionOf(fromAsset),
            ) > 0n
        );
    };
    const loading = policiesLoading || quotesLoading;
    const error = policiesError || quotesError;
    const empty = policies.length === 0 && quotes.length === 0;

    return (
        <section className="space-y-3">
            <div className="space-y-1">
                <h2 className="text-sm font-medium">Trades</h2>
                <p className="text-muted-foreground text-sm">
                    {canTake
                        ? `Orders ${display} has posted. Take one to fill it.`
                        : `Orders ${display} has posted.`}
                </p>
            </div>
            {loading ? (
                <p className="text-muted-foreground text-sm">Loading trades.</p>
            ) : error ? (
                <p className="text-destructive text-sm">
                    Couldn't load trades.
                </p>
            ) : empty ? (
                <p className="text-muted-foreground text-sm">
                    {display} has not posted a trade.
                </p>
            ) : (
                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Side</TableHead>
                                <TableHead>Pair</TableHead>
                                <TableHead className="text-right">
                                    Price
                                </TableHead>
                                <TableHead className="text-right">
                                    Quantity
                                </TableHead>
                                <TableHead className="text-right">
                                    Fee
                                </TableHead>
                                <TableHead className="text-right">
                                    Interest
                                </TableHead>
                                <TableHead className="text-right">
                                    Expires
                                </TableHead>
                                {canTake ? <TableHead /> : null}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {policies.map((p) => (
                                <TableRow
                                    key={`${p.fromAsset}-${p.toAsset}-${p.posterIsCreditor ? 1 : 0}`}
                                >
                                    <TableCell>
                                        {p.posterIsCreditor
                                            ? "They buy"
                                            : "They sell"}
                                    </TableCell>
                                    <TableCell>
                                        {symbolOf(p.fromAsset)} /{" "}
                                        {symbolOf(p.toAsset)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                        {formatFxToRate(
                                            p.fxRate,
                                            precisionOf(p.fromAsset),
                                            precisionOf(p.toAsset),
                                        )}{" "}
                                        {symbolOf(p.toAsset)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                        {displayAmount(p.remaining)}{" "}
                                        {symbolOf(p.fromAsset)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                        {displayAmount(p.feeFixed)}{" "}
                                        {symbolOf(p.fromAsset)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {ppmToPercent(p.toInterestRatePpm)}
                                    </TableCell>
                                    <TableCell className="text-right text-sm">
                                        {formatExpiresAt(p.expiresAt)}
                                    </TableCell>
                                    {canTake ? (
                                        <TableCell className="text-right">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    setTake({
                                                        kind: "policy",
                                                        policy: p,
                                                    })
                                                }
                                            >
                                                {convertsDebt(
                                                    p.fromAsset,
                                                    p.posterIsCreditor,
                                                )
                                                    ? "Rebook"
                                                    : "Open trade"}
                                            </Button>
                                        </TableCell>
                                    ) : null}
                                </TableRow>
                            ))}
                            {quotes.map((q) => {
                                const banxPrec = byId.has(q.assetId)
                                    ? precisionOf(q.assetId)
                                    : undefined;
                                const tokenPrec =
                                    tokenPrecisions.precision.get(q.tokenId);
                                const tokenLabel = `#${q.tokenId}`;
                                const banxLabel = symbolOf(q.assetId);
                                const price =
                                    banxPrec === undefined ||
                                    tokenPrec === undefined
                                        ? "…"
                                        : q.isOut
                                          ? `${formatFxToRate(q.fxRate, banxPrec, tokenPrec)} ${tokenLabel}`
                                          : `${formatFxToRate(q.fxRate, tokenPrec, banxPrec)} ${banxLabel}`;
                                return (
                                    <TableRow
                                        key={`cash-${q.isOut ? 1 : 0}-${q.assetId}-${q.tokenId}`}
                                    >
                                        <TableCell>
                                            {q.isOut ? "They buy" : "They sell"}
                                        </TableCell>
                                        <TableCell>
                                            {q.isOut
                                                ? `${banxLabel} / ${tokenLabel}`
                                                : `${tokenLabel} / ${banxLabel}`}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {price}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {displayAmount(q.remaining)}{" "}
                                            {q.isOut ? banxLabel : tokenLabel}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {displayAmount(q.feeFixed)}{" "}
                                            {q.isOut ? banxLabel : tokenLabel}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            —
                                        </TableCell>
                                        <TableCell className="text-right text-sm">
                                            {formatExpiresAt(q.expiresAt)}
                                        </TableCell>
                                        {canTake ? (
                                            <TableCell className="text-right">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        setTake({
                                                            kind: "cash",
                                                            quote: q,
                                                        })
                                                    }
                                                >
                                                    Take
                                                </Button>
                                            </TableCell>
                                        ) : null}
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
            {canTake ? (
                <TakeTradeDialog
                    trade={take}
                    taker={taker}
                    poster={account}
                    display={display}
                    onOpenChange={(open) => {
                        if (!open) setTake(null);
                    }}
                />
            ) : null}
        </section>
    );
}

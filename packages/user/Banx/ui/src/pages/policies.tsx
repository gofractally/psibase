import { useRef, useState } from "react";
import { useStore } from "@tanstack/react-form";

import { ArrowDownUp, ChevronDown, Plus } from "lucide-react";

import { AssetField, ExpiresField } from "@/components/form-fields";
import { formatExpiresAt } from "@/components/expires-at-picker";
import { PageHeader } from "@/components/page-header";
import {
    TradeNetworkDialog,
    type TradePair,
} from "@/components/trade-network-dialog";
import { useAssetMap } from "@/hooks/use-assets";
import {
    useCashQuotes,
    useFxOffers,
    useTokenPrecisionMap,
} from "@/hooks/use-banx-data";
import {
    useRemoveCashQuote,
    useRemoveFxOffer,
    useSetCashQuote,
    useSetFxOffer,
    useSetExchangeQuotes,
} from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    convertAtQuotedRate,
    exchangeFxRates,
    flipLeftTyped,
    keptOnFlip,
    displayAmount,
    formatFxToRate,
    formatToPrecision,
    invertQuotedRate,
} from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";
import {
    MAX_HOP_FEE_PERCENT,
    MAX_HOP_FEE_PPM,
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    amountFieldValidator,
    percentFieldValidator,
    percentStringToPpm,
    useAppForm,
} from "@/lib/form";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@shared/shadcn/ui/collapsible";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { toast } from "@shared/shadcn/ui/sonner";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

type LegKind = "banx" | "token";

type Leg = { kind: LegKind; id: number };

function parseTokenId(raw: string): number | undefined {
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n <= 0) return undefined;
    return n;
}

function legOf(
    kind: LegKind,
    assetId: number | undefined,
    tokenRaw: string,
): Leg | undefined {
    if (kind === "banx") {
        return assetId === undefined ? undefined : { kind, id: assetId };
    }
    const id = parseTokenId(tokenRaw);
    return id === undefined ? undefined : { kind, id };
}

function sameLegs(from: Leg, to: Leg): boolean {
    return from.kind === to.kind && from.id === to.id;
}

/**
 * A cash quote prices what the other person pays.
 * A buy already states that side, so the typed price and quantity post as-is.
 * A sell states what you give, so those amounts are turned into the payment first.
 */
function cashOrderArgs(args: {
    buying: boolean;
    from: Leg;
    to: Leg;
    price: string;
    quantity: string;
    fee: string;
    fromPrec: number;
    toPrec: number;
}):
    | {
          assetId: number;
          tokenId: number;
          isOut: boolean;
          feeFixed: string;
          toRate: string;
          remaining: string;
      }
    | string {
    const banx = args.from.kind === "banx" ? args.from : args.to;
    const token = args.from.kind === "token" ? args.from : args.to;
    if (banx.kind !== "banx" || token.kind !== "token") {
        return "A token trades against an IOU.";
    }
    if (args.buying) {
        return {
            assetId: banx.id,
            tokenId: token.id,
            isOut: args.from.kind === "banx",
            feeFixed: args.fee.trim() || "0",
            toRate: args.price.trim(),
            remaining: args.quantity.trim(),
        };
    }
    const rate = invertQuotedRate(args.price, args.fromPrec, args.toPrec);
    const remaining = convertAtQuotedRate(
        args.quantity,
        args.price,
        args.fromPrec,
        args.toPrec,
    );
    const fee = convertAtQuotedRate(
        args.fee.trim() || "0",
        args.price,
        args.fromPrec,
        args.toPrec,
    );
    if (!rate || !remaining || !fee) {
        return "That amount is too small to convert at this rate.";
    }
    return {
        assetId: banx.id,
        tokenId: token.id,
        isOut: args.from.kind === "token",
        feeFixed: fee,
        toRate: rate,
        remaining,
    };
}

function LegKindToggle({
    kind,
    onChange,
    tokenDisabled,
}: {
    kind: LegKind;
    onChange: (kind: LegKind) => void;
    /** The other leg is already a token. A token only trades against an IOU. */
    tokenDisabled?: boolean;
}) {
    return (
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5">
            {(["banx", "token"] as const).map((next) => {
                const blocked =
                    next === "token" && !!tokenDisabled && kind !== "token";
                return (
                    <button
                        key={next}
                        type="button"
                        disabled={blocked}
                        title={
                            blocked
                                ? "A token trades against an IOU."
                                : undefined
                        }
                        className={cn(
                            "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                            kind === next
                                ? "bg-background shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            blocked &&
                                "cursor-not-allowed opacity-40 hover:text-muted-foreground",
                        )}
                        onClick={() => {
                            if (!blocked) onChange(next);
                        }}
                    >
                        {next === "banx" ? "IOU" : "Token"}
                    </button>
                );
            })}
        </div>
    );
}

export function PoliciesPage() {
    const { data: user } = useCurrentUser();
    const { assets, byId, symbolOf, precisionOf } = useAssetMap();
    const { data: currency = [] } = useFxOffers();
    const { data: cashQuotes = [] } = useCashQuotes(user ?? null);
    const setCurrency = useSetFxOffer();
    const setExchange = useSetExchangeQuotes();
    const setCash = useSetCashQuote();
    const removeCurrency = useRemoveFxOffer();
    const removeCash = useRemoveCashQuote();
    const [moreOpen, setMoreOpen] = useState(false);
    const [orderOpen, setOrderOpen] = useState(false);
    const [network, setNetwork] = useState<TradePair | null>(null);
    const precRef = useRef<(leg: Leg) => number | undefined>(() => undefined);

    const currencyForm = useAppForm({
        defaultValues: {
            fromKind: "banx" as LegKind,
            toKind: "banx" as LegKind,
            fromAsset: undefined as number | undefined,
            toAsset: undefined as number | undefined,
            fromToken: "",
            toToken: "",
            quoteMode: "they" as "they" | "me" | "both",
            feeFixed: "0",
            toRate: "1",
            spreadPct: "",
            aprPct: "0",
            remaining: "",
            remainingOther: "",
            expiresAtSeconds: 0,
        },
        onSubmit: async ({ value }) => {
            const from = legOf(value.fromKind, value.fromAsset, value.fromToken);
            const to = legOf(value.toKind, value.toAsset, value.toToken);
            if (!from || !to || sameLegs(from, to)) {
                toast.error("Pick two different assets.");
                return;
            }
            if (!value.remaining.trim()) {
                toast.error("Enter a quantity.");
                return;
            }
            if (from.kind === "token" && to.kind === "token") {
                toast.error("A token trades against an IOU.");
                return;
            }
            const mixed = from.kind !== to.kind;
            if (mixed) {
                if (value.quoteMode === "both" || !value.toRate.trim()) {
                    toast.error("Enter a price.");
                    return;
                }
                const fromPrec = precRef.current(from);
                const toPrec = precRef.current(to);
                if (fromPrec === undefined || toPrec === undefined) {
                    toast.error("Precision isn't loaded yet.");
                    return;
                }
                const order = cashOrderArgs({
                    buying: value.quoteMode === "they",
                    from,
                    to,
                    price: value.toRate,
                    quantity: value.remaining,
                    fee: value.feeFixed,
                    fromPrec,
                    toPrec,
                });
                if (typeof order === "string") {
                    toast.error(order);
                    return;
                }
                await new Promise<void>((resolve, reject) => {
                    setCash.mutate(
                        { ...order, expiresAtSeconds: value.expiresAtSeconds },
                        {
                            onSuccess: () => resolve(),
                            onError: (e: Error) => reject(e),
                        },
                    );
                });
                setOrderOpen(false);
                return;
            }
            const toInterestRatePpm = percentStringToPpm(
                value.aprPct,
                PPM_SCALE,
            );
            if (value.quoteMode === "both") {
                if (!value.remainingOther.trim() || !value.toRate.trim()) {
                    toast.error(
                        !value.toRate.trim()
                            ? "Enter a price."
                            : "Enter both quantities.",
                    );
                    return;
                }
                const spreadPpm = percentStringToPpm(
                    value.spreadPct.trim() || "0",
                    MAX_HOP_FEE_PPM,
                );
                await new Promise<void>((resolve, reject) => {
                    setExchange.mutate(
                        {
                            assetA: from.id,
                            assetB: to.id,
                            marketRate: value.toRate.trim(),
                            spreadPpm,
                            remainingA: value.remaining.trim(),
                            remainingB: value.remainingOther.trim(),
                            toInterestRatePpm,
                            expiresAtSeconds: value.expiresAtSeconds,
                        },
                        {
                            onSuccess: () => resolve(),
                            onError: (e: Error) => reject(e),
                        },
                    );
                });
                setOrderOpen(false);
                return;
            }
            if (!value.toRate.trim()) {
                toast.error("Enter a price.");
                return;
            }
            await new Promise<void>((resolve, reject) => {
                setCurrency.mutate(
                    {
                        fromAsset: from.id,
                        toAsset: to.id,
                        posterIsCreditor: value.quoteMode === "they",
                        feeFixed: value.feeFixed.trim(),
                        toRate: value.toRate.trim(),
                        toInterestRatePpm,
                        remaining: value.remaining.trim(),
                        expiresAtSeconds: value.expiresAtSeconds,
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
            setOrderOpen(false);
        },
    });

    const fromTokenRaw = useStore(
        currencyForm.store,
        (s) => s.values.fromToken,
    );
    const toTokenRaw = useStore(currencyForm.store, (s) => s.values.toToken);
    const tokenPrecisions = useTokenPrecisionMap([
        parseTokenId(fromTokenRaw) ?? 0,
        parseTokenId(toTokenRaw) ?? 0,
        ...cashQuotes.map((q) => q.tokenId),
    ]);

    const legPrecision = (leg: Leg): number | undefined => {
        if (leg.kind === "banx") {
            return byId.has(leg.id) ? precisionOf(leg.id) : undefined;
        }
        return tokenPrecisions.precision.get(leg.id);
    };
    precRef.current = legPrecision;

    return (
        <div className="space-y-10">
            <PageHeader
                title="Trade"
                description="Orders you have posted. Swap uses someone else's rate instead."
                action={
                    <Button
                        type="button"
                        size="icon"
                        className="size-11 shrink-0 rounded-full bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 sm:size-9"
                        aria-label="Place an order"
                        onClick={() => setOrderOpen(true)}
                    >
                        <Plus className="size-5" />
                    </Button>
                }
            />

            <section>
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
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {currency.length === 0 &&
                            cashQuotes.length === 0 ? (
                                <TableRow>
                                    <TableCell
                                        colSpan={8}
                                        className="text-muted-foreground text-sm"
                                    >
                                        None yet.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                currency.map((p) => (
                                    <TableRow
                                        key={`${p.fromAsset}-${p.toAsset}-${p.posterIsCreditor ? 1 : 0}`}
                                    >
                                        <TableCell>
                                            {p.posterIsCreditor
                                                ? "You buy"
                                                : "You sell"}
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
                                        <TableCell className="text-right">
                                            <div className="flex flex-wrap justify-end gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    aria-label={`Network for ${symbolOf(p.fromAsset)} and ${symbolOf(p.toAsset)}`}
                                                    onClick={() =>
                                                        setNetwork({
                                                            left: {
                                                                kind: "banx",
                                                                assetId:
                                                                    p.fromAsset,
                                                                symbol: symbolOf(
                                                                    p.fromAsset,
                                                                ),
                                                            },
                                                            right: {
                                                                kind: "banx",
                                                                assetId:
                                                                    p.toAsset,
                                                                symbol: symbolOf(
                                                                    p.toAsset,
                                                                ),
                                                            },
                                                        })
                                                    }
                                                >
                                                    Network
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={
                                                        removeCurrency.isPending
                                                    }
                                                    onClick={() =>
                                                        removeCurrency.mutate({
                                                            fromAsset:
                                                                p.fromAsset,
                                                            toAsset: p.toAsset,
                                                            posterIsCreditor:
                                                                p.posterIsCreditor,
                                                        })
                                                    }
                                                >
                                                    Remove
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                            {cashQuotes.map((q) => {
                                const banxPrec = byId.has(q.assetId)
                                    ? precisionOf(q.assetId)
                                    : undefined;
                                const tokenPrec = tokenPrecisions.precision.get(
                                    q.tokenId,
                                );
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
                                            {q.isOut ? "You buy" : "You sell"}
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
                                        <TableCell className="text-right">
                                            <div className="flex flex-wrap justify-end gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    aria-label={`Network for ${q.isOut ? banxLabel : tokenLabel} and ${q.isOut ? tokenLabel : banxLabel}`}
                                                    onClick={() => {
                                                        const iou = {
                                                            kind: "banx" as const,
                                                            assetId: q.assetId,
                                                            symbol: banxLabel,
                                                        };
                                                        const token = {
                                                            kind: "token" as const,
                                                            tokenId: q.tokenId,
                                                            symbol: tokenLabel,
                                                        };
                                                        setNetwork(
                                                            q.isOut
                                                                ? {
                                                                      left: iou,
                                                                      right: token,
                                                                  }
                                                                : {
                                                                      left: token,
                                                                      right: iou,
                                                                  },
                                                        );
                                                    }}
                                                >
                                                    Network
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={
                                                        removeCash.isPending
                                                    }
                                                    onClick={() =>
                                                        removeCash.mutate({
                                                            assetId: q.assetId,
                                                            tokenId: q.tokenId,
                                                            isOut: q.isOut,
                                                        })
                                                    }
                                                >
                                                    Remove
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </section>

            <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
                <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] flex-col overflow-y-auto sm:max-w-xl">
                    <DialogHeader className="pr-8">
                        <DialogTitle>Place an order</DialogTitle>
                        <DialogDescription>
                            A buy is filled by someone who already owes you, or
                            by opening both sides when you have lined each other.
                            A sell only converts a debt you already owe. Pick a
                            token on one side to trade it for an IOU.
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="grid gap-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void currencyForm.handleSubmit();
                        }}
                    >
                    <currencyForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) => {
                            const fromLeg = legOf(
                                values.fromKind,
                                values.fromAsset,
                                values.fromToken,
                            );
                            const toLeg = legOf(
                                values.toKind,
                                values.toAsset,
                                values.toToken,
                            );
                            const fromSym = fromLeg
                                ? fromLeg.kind === "token"
                                    ? `#${fromLeg.id}`
                                    : symbolOf(fromLeg.id)
                                : "from";
                            const toSym = toLeg
                                ? toLeg.kind === "token"
                                    ? `#${toLeg.id}`
                                    : symbolOf(toLeg.id)
                                : "to";
                            const fromPrec = fromLeg
                                ? legPrecision(fromLeg)
                                : undefined;
                            const toPrec = toLeg
                                ? legPrecision(toLeg)
                                : undefined;
                            const rateShown =
                                toPrec !== undefined
                                    ? (formatToPrecision(
                                          values.toRate,
                                          toPrec,
                                      ) ?? values.toRate)
                                    : values.toRate;
                            const bothChosen = !!fromLeg && !!toLeg;
                            const mixed = values.fromKind !== values.toKind;
                            const bothTokens =
                                values.fromKind === "token" &&
                                values.toKind === "token";
                            const samePair =
                                !!fromLeg && !!toLeg && sameLegs(fromLeg, toLeg);
                            const banxPair =
                                values.fromKind === "banx" &&
                                values.toKind === "banx";
                            const feeText = values.feeFixed.trim();
                            const feeIsZero =
                                feeText === "" || feeText === "0";
                            const theyOweMe = values.quoteMode === "they";
                            const bothWays =
                                values.quoteMode === "both" && banxPair;
                            const spreadText = values.spreadPct.trim();
                            const spreadNumber =
                                spreadText === "" ? 0 : Number(spreadText);
                            const spreadOk =
                                Number.isFinite(spreadNumber) &&
                                spreadNumber >= 0 &&
                                spreadNumber <= MAX_HOP_FEE_PERCENT;
                            const exchange =
                                bothWays &&
                                bothChosen &&
                                !samePair &&
                                fromPrec !== undefined &&
                                toPrec !== undefined &&
                                spreadOk
                                    ? exchangeFxRates(
                                          values.toRate,
                                          percentStringToPpm(
                                              spreadText || "0",
                                              MAX_HOP_FEE_PPM,
                                          ),
                                          fromPrec,
                                          toPrec,
                                      )
                                    : null;
                            const forwardShown = exchange
                                ? formatFxToRate(
                                      exchange.forwardFx.toString(),
                                      fromPrec!,
                                      toPrec!,
                                  )
                                : null;
                            const backShown = exchange
                                ? formatFxToRate(
                                      exchange.backFx.toString(),
                                      toPrec!,
                                      fromPrec!,
                                  )
                                : null;
                            const chooseKind = (
                                field: "fromKind" | "toKind",
                                kind: LegKind,
                            ) => {
                                const other =
                                    field === "fromKind" ? "toKind" : "fromKind";
                                currencyForm.setFieldValue(field, kind);
                                if (kind !== "token") return;
                                // A token has no quote against another token.
                                if (values[other] === "token") {
                                    currencyForm.setFieldValue(other, "banx");
                                }
                                if (values.quoteMode === "both") {
                                    currencyForm.setFieldValue(
                                        "quoteMode",
                                        "they",
                                    );
                                }
                            };
                            return (
                                <>
                                    <div className="grid gap-2">
                                        <p className="text-sm font-medium">
                                            Side
                                        </p>
                                        <div
                                            className={cn(
                                                "grid gap-2",
                                                banxPair
                                                    ? "grid-cols-3"
                                                    : "grid-cols-2",
                                            )}
                                        >
                                            <Button
                                                type="button"
                                                variant={
                                                    theyOweMe
                                                        ? "default"
                                                        : "outline"
                                                }
                                                aria-pressed={theyOweMe}
                                                onClick={() =>
                                                    currencyForm.setFieldValue(
                                                        "quoteMode",
                                                        "they",
                                                    )
                                                }
                                            >
                                                You buy
                                            </Button>
                                            <Button
                                                type="button"
                                                variant={
                                                    values.quoteMode === "me"
                                                        ? "default"
                                                        : "outline"
                                                }
                                                aria-pressed={
                                                    values.quoteMode === "me"
                                                }
                                                onClick={() =>
                                                    currencyForm.setFieldValue(
                                                        "quoteMode",
                                                        "me",
                                                    )
                                                }
                                            >
                                                You sell
                                            </Button>
                                            {banxPair ? (
                                                <Button
                                                    type="button"
                                                    variant={
                                                        bothWays
                                                            ? "default"
                                                            : "outline"
                                                    }
                                                    aria-pressed={bothWays}
                                                    onClick={() =>
                                                        currencyForm.setFieldValue(
                                                            "quoteMode",
                                                            "both",
                                                        )
                                                    }
                                                >
                                                    Two-sided
                                                </Button>
                                            ) : null}
                                        </div>
                                    </div>
                                    <div className="relative grid">
                                        <div className="bg-muted/60 space-y-2 rounded-2xl p-3">
                                            <LegKindToggle
                                                kind={values.fromKind}
                                                tokenDisabled={
                                                    values.toKind === "token"
                                                }
                                                onChange={(kind) =>
                                                    chooseKind("fromKind", kind)
                                                }
                                            />
                                            {values.fromKind === "banx" ? (
                                                <currencyForm.Field
                                                    name="fromAsset"
                                                    children={(field) => (
                                                        <AssetField
                                                            label={
                                                                bothWays
                                                                    ? "Base"
                                                                    : theyOweMe
                                                                      ? "Buy"
                                                                      : "Sell"
                                                            }
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
                                                <currencyForm.AppField
                                                    name="fromToken"
                                                    children={(field) => (
                                                        <field.TextField
                                                            label={
                                                                bothWays
                                                                    ? "Base"
                                                                    : theyOweMe
                                                                      ? "Buy"
                                                                      : "Sell"
                                                            }
                                                            inputMode="numeric"
                                                            placeholder="Token number"
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
                                                aria-label="Flip the pair"
                                                onClick={() => {
                                                    const swapLegs = () => {
                                                        currencyForm.setFieldValue(
                                                            "fromKind",
                                                            values.toKind,
                                                        );
                                                        currencyForm.setFieldValue(
                                                            "toKind",
                                                            values.fromKind,
                                                        );
                                                        currencyForm.setFieldValue(
                                                            "fromAsset",
                                                            values.toAsset,
                                                        );
                                                        currencyForm.setFieldValue(
                                                            "toAsset",
                                                            values.fromAsset,
                                                        );
                                                        currencyForm.setFieldValue(
                                                            "fromToken",
                                                            values.toToken,
                                                        );
                                                        currencyForm.setFieldValue(
                                                            "toToken",
                                                            values.fromToken,
                                                        );
                                                    };
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
                                                                bothChosen
                                                                    ? "Asset precision isn't loaded yet."
                                                                    : "Pick both assets before flipping a rate.",
                                                            );
                                                            return;
                                                        }
                                                        swapLegs();
                                                        return;
                                                    }
                                                    if (bothWays) {
                                                        const inverted =
                                                            invertQuotedRate(
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
                                                        if (
                                                            flipLeftTyped(
                                                                values.toRate,
                                                                inverted,
                                                                nextRate,
                                                            )
                                                        ) {
                                                            toast.error(
                                                                "That amount is too small to convert at this rate, so it was left as typed.",
                                                            );
                                                        }
                                                        swapLegs();
                                                        currencyForm.setFieldValue(
                                                            "toRate",
                                                            nextRate,
                                                        );
                                                        currencyForm.setFieldValue(
                                                            "remaining",
                                                            values.remainingOther,
                                                        );
                                                        currencyForm.setFieldValue(
                                                            "remainingOther",
                                                            values.remaining,
                                                        );
                                                        return;
                                                    }
                                                    swapLegs();
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
                                            <LegKindToggle
                                                kind={values.toKind}
                                                tokenDisabled={
                                                    values.fromKind === "token"
                                                }
                                                onChange={(kind) =>
                                                    chooseKind("toKind", kind)
                                                }
                                            />
                                            {values.toKind === "banx" ? (
                                                <currencyForm.Field
                                                    name="toAsset"
                                                    children={(field) => (
                                                        <AssetField
                                                            label={
                                                                bothWays
                                                                    ? "Quote"
                                                                    : "For"
                                                            }
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
                                                <currencyForm.AppField
                                                    name="toToken"
                                                    children={(field) => (
                                                        <field.TextField
                                                            label={
                                                                bothWays
                                                                    ? "Quote"
                                                                    : "For"
                                                            }
                                                            inputMode="numeric"
                                                            placeholder="Token number"
                                                        />
                                                    )}
                                                />
                                            )}
                                            <currencyForm.AppField
                                                name="toRate"
                                                validators={
                                                    toPrec === undefined
                                                        ? undefined
                                                        : {
                                                              onChange:
                                                                  amountFieldValidator(
                                                                      toPrec,
                                                                      {
                                                                          allowEmpty:
                                                                              true,
                                                                      },
                                                                  ),
                                                              onSubmit:
                                                                  amountFieldValidator(
                                                                      toPrec,
                                                                      {
                                                                          allowEmpty:
                                                                              true,
                                                                      },
                                                                  ),
                                                          }
                                                }
                                                children={(field) => (
                                                    <field.TextField
                                                        label={
                                                            bothChosen
                                                                ? `Price (${toSym} per 1 ${fromSym})`
                                                                : "Price"
                                                        }
                                                        inputMode="decimal"
                                                        placeholder={
                                                            bothWays
                                                                ? "1.20"
                                                                : "0.45"
                                                        }
                                                    />
                                                )}
                                            />
                                        </div>
                                    </div>

                                    <p className="text-muted-foreground text-sm">
                                        {bothWays ? (
                                            samePair ? (
                                                <>Pick two different assets.</>
                                            ) : forwardShown && backShown ? (
                                                <>
                                                    <span className="text-foreground font-medium">
                                                        1 {fromSym}
                                                    </span>{" "}
                                                    becomes{" "}
                                                    <span className="text-foreground font-medium">
                                                        {forwardShown} {toSym}.
                                                    </span>{" "}
                                                    <span className="text-foreground font-medium">
                                                        1 {toSym}
                                                    </span>{" "}
                                                    becomes{" "}
                                                    <span className="text-foreground font-medium">
                                                        {backShown} {fromSym}.
                                                    </span>{" "}
                                                    The fee is already in
                                                    these prices. A payment
                                                    through you uses the buy.
                                                    Swap can also spend that
                                                    rate.
                                                </>
                                            ) : (
                                                <>
                                                    Enter a price. A 5 percent
                                                    fee on 1.20 posts 1.14
                                                    each way. Leave the fee
                                                    empty for none.
                                                </>
                                            )
                                        ) : bothTokens ? (
                                            <>
                                                A token trades against an IOU.
                                            </>
                                        ) : samePair ? (
                                            <>Pick two different assets.</>
                                        ) : bothChosen && rateShown ? (
                                            <>
                                                <span className="text-foreground font-medium">
                                                    1 {fromSym}
                                                </span>{" "}
                                                {theyOweMe ? "buys " : "sells for "}
                                                <span className="text-foreground font-medium">
                                                    {rateShown} {toSym}.
                                                </span>
                                                {feeIsZero
                                                    ? null
                                                    : mixed
                                                      ? " The fee comes off what they pay."
                                                      : theyOweMe
                                                        ? " The fee is added to the amount you buy."
                                                        : " The fee comes off the amount you sell."}
                                            </>
                                        ) : (
                                            <>Pick both assets and a price.</>
                                        )}
                                    </p>

                                    {bothWays ? (
                                        <currencyForm.AppField
                                            name="spreadPct"
                                            validators={{
                                                onChange:
                                                    percentFieldValidator(
                                                        MAX_HOP_FEE_PERCENT,
                                                        true,
                                                    ),
                                                onSubmit:
                                                    percentFieldValidator(
                                                        MAX_HOP_FEE_PERCENT,
                                                        true,
                                                    ),
                                            }}
                                            children={(field) => (
                                                <field.TextField
                                                    label="Your fee percent"
                                                    description="Taken off the price in each direction. Leave empty for no fee."
                                                    inputMode="decimal"
                                                    placeholder="0"
                                                    min={0}
                                                    max={MAX_HOP_FEE_PERCENT}
                                                    step={MIN_PERCENT_STEP}
                                                />
                                            )}
                                        />
                                    ) : null}

                                    {bothWays ? (
                                        <p className="text-muted-foreground text-sm">
                                            Each quantity is how much of that
                                            asset the order will take. Saving
                                            again replaces it.
                                        </p>
                                    ) : banxPair ? (
                                        <p className="text-muted-foreground text-sm">
                                            This remaining is a public path
                                            rate, not a private quote for one
                                            person. Anyone who can draw you in{" "}
                                            {fromSym} can spend it on a payment.
                                            Saving again replaces it.
                                        </p>
                                    ) : null}
                                    <currencyForm.AppField
                                        name="remaining"
                                        validators={
                                            fromPrec === undefined
                                                ? undefined
                                                : {
                                                      onChange:
                                                          amountFieldValidator(
                                                              fromPrec,
                                                              {
                                                                  allowZero:
                                                                      false,
                                                              },
                                                          ),
                                                      onSubmit:
                                                          amountFieldValidator(
                                                              fromPrec,
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
                                                    fromLeg
                                                        ? `Quantity (${fromSym})`
                                                        : "Quantity"
                                                }
                                                inputMode="decimal"
                                                placeholder={
                                                    fromPrec !== undefined
                                                        ? amountPlaceholder(
                                                              fromPrec,
                                                          )
                                                        : "0"
                                                }
                                            />
                                        )}
                                    />
                                    {bothWays ? (
                                        <currencyForm.AppField
                                            name="remainingOther"
                                            validators={
                                                toPrec === undefined
                                                    ? undefined
                                                    : {
                                                          onChange:
                                                              amountFieldValidator(
                                                                  toPrec,
                                                                  {
                                                                      allowZero:
                                                                          false,
                                                                  },
                                                              ),
                                                          onSubmit:
                                                              amountFieldValidator(
                                                                  toPrec,
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
                                                        toLeg
                                                            ? `Quantity (${toSym})`
                                                            : "Quantity"
                                                    }
                                                    inputMode="decimal"
                                                    placeholder={
                                                        toPrec !== undefined
                                                            ? amountPlaceholder(
                                                                  toPrec,
                                                              )
                                                            : "0"
                                                    }
                                                />
                                            )}
                                        />
                                    ) : null}
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
                                                {mixed
                                                    ? "Fee and expiry"
                                                    : bothWays
                                                      ? "Interest and expiry"
                                                      : "Fee, interest, and expiry"}
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
                                                {mixed
                                                    ? "The fee comes off what they pay, before the price."
                                                    : bothWays
                                                      ? "A payment through you uses the buy. The fee is already in the price."
                                                      : theyOweMe
                                                        ? "A payment that changes asset while it goes through you uses this buy. The fee comes off what you owe onward."
                                                        : "A payment does not use a sell. It converts a debt you already owe."}
                                            </p>
                                            {bothWays ? null : (
                                                <currencyForm.AppField
                                                    name="feeFixed"
                                                    validators={
                                                        fromPrec === undefined
                                                            ? undefined
                                                            : {
                                                                  onChange:
                                                                      amountFieldValidator(
                                                                          fromPrec,
                                                                          {
                                                                              allowEmpty:
                                                                                  true,
                                                                          },
                                                                      ),
                                                                  onSubmit:
                                                                      amountFieldValidator(
                                                                          fromPrec,
                                                                          {
                                                                              allowEmpty:
                                                                                  true,
                                                                          },
                                                                      ),
                                                              }
                                                    }
                                                    children={(field) => (
                                                        <field.TextField
                                                            label={
                                                                fromLeg
                                                                    ? `Fee (${fromSym})`
                                                                    : "Fee"
                                                            }
                                                            description={
                                                                mixed
                                                                    ? "Taken off what they pay, before the price."
                                                                    : theyOweMe
                                                                      ? "On a convert, added to the amount you buy, then priced."
                                                                      : "Taken off the amount you sell, before the price."
                                                            }
                                                            inputMode="decimal"
                                                            placeholder={
                                                                fromPrec !==
                                                                undefined
                                                                    ? amountPlaceholder(
                                                                          fromPrec,
                                                                      )
                                                                    : "0"
                                                            }
                                                        />
                                                    )}
                                                />
                                            )}
                                            {mixed ? null : (
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
                                            )}
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
                                    labels={
                                        values.quoteMode === "both" &&
                                        values.fromKind === "banx" &&
                                        values.toKind === "banx"
                                            ? ["Post orders", "Posting…"]
                                            : ["Post order", "Posting…"]
                                    }
                                    loading={
                                        setCurrency.isPending ||
                                        setExchange.isPending ||
                                        setCash.isPending
                                    }
                                    disabled={(() => {
                                        const from = legOf(
                                            values.fromKind,
                                            values.fromAsset,
                                            values.fromToken,
                                        );
                                        const to = legOf(
                                            values.toKind,
                                            values.toAsset,
                                            values.toToken,
                                        );
                                        if (
                                            !from ||
                                            !to ||
                                            sameLegs(from, to) ||
                                            !values.remaining.trim() ||
                                            (from.kind === "token" &&
                                                to.kind === "token")
                                        ) {
                                            return true;
                                        }
                                        if (from.kind !== to.kind) {
                                            return !values.toRate.trim();
                                        }
                                        return (
                                            values.quoteMode === "both" &&
                                            (!values.remainingOther.trim() ||
                                                !values.toRate.trim())
                                        );
                                    })()}
                                />
                            </currencyForm.AppForm>
                        )}
                    />
                    </form>
                </DialogContent>
            </Dialog>
            <TradeNetworkDialog
                pair={network}
                onOpenChange={(open) => {
                    if (!open) setNetwork(null);
                }}
            />
        </div>
    );
}

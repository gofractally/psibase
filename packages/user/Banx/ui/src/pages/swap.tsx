import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLocalStorage } from "usehooks-ts";

import { ArrowDownUp } from "lucide-react";

import { CurrencyPicker } from "@/components/currency-picker";
import { PageHeader } from "@/components/page-header";
import { PathRoute } from "@/components/path-route";
import { useAssetMap } from "@/hooks/use-assets";
import { useBanxContacts } from "@/hooks/use-banx-contacts";
import {
    usePathPay,
    useQuotePath,
    type PathQuote,
} from "@/hooks/use-banx-mutations";
import { amountPlaceholder, displayAmount } from "@/lib/amount";
import { assetIdBySymbol } from "@/lib/transfer-url";
import { amountFieldValidator } from "@/lib/form";
import type { Asset } from "@/lib/graphql";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import { Card } from "@shared/shadcn/ui/card";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Separator } from "@shared/shadcn/ui/separator";

/** A return through one middleman is 2 hops. Eight is search room under the plugin cap of 12. */
const SWAP_MAX_HOPS = 8;

/** `from` / `to` may be a symbol (`AUD`) or a numeric asset id. */
function assetFromQuery(
    raw: string | null,
    assets: { id: number; symbol: string }[],
): number | undefined {
    if (!raw?.trim()) return undefined;
    const bySymbol = assetIdBySymbol(raw, assets);
    if (bySymbol !== undefined) return bySymbol;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return undefined;
    return assets.some((a) => a.id === id) ? id : undefined;
}

function sanitizeAmount(raw: string): string {
    const cleaned = raw.replace(/[^\d.]/g, "");
    const dot = cleaned.indexOf(".");
    if (dot === -1) return cleaned;
    return `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, "")}`;
}

function AmountRow({
    label,
    amount,
    onAmount,
    readOnly,
    disabled,
    placeholder,
    assets,
    assetId,
    onAsset,
}: {
    label: string;
    amount: string;
    onAmount?: (amount: string) => void;
    readOnly?: boolean;
    disabled?: boolean;
    placeholder: string;
    assets: Asset[];
    assetId: number | undefined;
    onAsset: (id: number) => void;
}) {
    const inputId = useId();
    return (
        <div className="flex flex-col gap-1.5">
            <Label
                htmlFor={inputId}
                className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase"
            >
                {label}
            </Label>
            <div className="relative">
                <Input
                    id={inputId}
                    value={amount}
                    readOnly={readOnly}
                    disabled={disabled}
                    tabIndex={readOnly || disabled ? -1 : undefined}
                    inputMode="decimal"
                    placeholder={placeholder}
                    onChange={
                        readOnly || disabled
                            ? undefined
                            : (e) => onAmount?.(sanitizeAmount(e.target.value))
                    }
                    className="h-14 pr-32 font-mono text-2xl tabular-nums md:text-2xl"
                />
                <div className="absolute top-1/2 right-2 -translate-y-1/2">
                    <CurrencyPicker
                        variant="pill"
                        assets={assets}
                        assetId={assetId}
                        onAssetId={onAsset}
                        disabled={disabled}
                    />
                </div>
            </div>
        </div>
    );
}

export function SwapPage() {
    const { data: user } = useCurrentUser();
    const { assets, byId, symbolOf, precisionOf } = useAssetMap();
    const { label } = useBanxContacts("/swap");
    const { mutate: quotePath, isPending: quoting } = useQuotePath();
    const pathPay = usePathPay();
    const [searchParams, setSearchParams] = useSearchParams();
    const [payAsset, setPayAsset] = useLocalStorage<number | null>(
        "banx.swap.fromAsset",
        null,
    );
    const [receiveAsset, setReceiveAsset] = useLocalStorage<number | null>(
        "banx.swap.toAsset",
        null,
    );
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const fromQuery = assetFromQuery(fromParam, assets);
    const toQuery = assetFromQuery(toParam, assets);

    useEffect(() => {
        if (fromQuery !== undefined && fromQuery !== payAsset) {
            setPayAsset(fromQuery);
        }
        if (toQuery !== undefined && toQuery !== receiveAsset) {
            setReceiveAsset(toQuery);
        }
    }, [fromQuery, toQuery, payAsset, receiveAsset, setPayAsset, setReceiveAsset]);

    const writePair = (from: number | null, to: number | null) => {
        const next = new URLSearchParams(searchParams);
        const fromSymbol = from != null ? symbolOf(from) : "";
        const toSymbol = to != null ? symbolOf(to) : "";
        if (fromSymbol) next.set("from", fromSymbol);
        else next.delete("from");
        if (toSymbol) next.set("to", toSymbol);
        else next.delete("to");
        setSearchParams(next, { replace: true });
    };
    const [payAmount, setPayAmount] = useState("");
    const [quote, setQuote] = useState<PathQuote | null>(null);
    const [quoteError, setQuoteError] = useState<string | null>(null);
    const [searching, setSearching] = useState(false);
    const generation = useRef(0);
    // The payment uses the quote from the click. A later edit is a new draft.
    const draft = useRef({
        amount: "",
        payAsset: null as number | null,
        receiveAsset: null as number | null,
    });
    draft.current = {
        amount: payAmount,
        payAsset,
        receiveAsset,
    };
    const paying = pathPay.isPending;

    const payPrecision =
        payAsset != null && byId.has(payAsset)
            ? precisionOf(payAsset)
            : undefined;
    const amountError = payAmount.trim()
        ? amountFieldValidator(payPrecision ?? 0, { allowZero: false })({
              value: payAmount,
          })
        : undefined;
    const distinct =
        payAsset != null &&
        receiveAsset != null &&
        payAsset !== receiveAsset;
    const canQuote =
        !!user &&
        distinct &&
        payPrecision !== undefined &&
        !amountError &&
        payAmount.trim() !== "";

    useEffect(() => {
        const id = ++generation.current;
        setQuote(null);
        setQuoteError(null);
        if (!canQuote || !user || payAsset == null || receiveAsset == null) {
            setSearching(false);
            return;
        }
        setSearching(true);
        const timer = window.setTimeout(() => {
            quotePath(
                {
                    fromAccount: user,
                    toAccount: user,
                    amount: payAmount.trim(),
                    fromAsset: payAsset,
                    toAsset: receiveAsset,
                    maxHops: SWAP_MAX_HOPS,
                },
                {
                    onSuccess: (next) => {
                        if (generation.current !== id) return;
                        setQuote(next);
                        setQuoteError(null);
                        setSearching(false);
                    },
                    onError: (error: Error) => {
                        if (generation.current !== id) return;
                        setQuote(null);
                        setQuoteError(error.message);
                        setSearching(false);
                    },
                },
            );
        }, 400);
        return () => window.clearTimeout(timer);
    }, [canQuote, payAmount, payAsset, quotePath, receiveAsset, user]);

    const paySymbol = payAsset != null ? symbolOf(payAsset) : "";
    const receiveSymbol = receiveAsset != null ? symbolOf(receiveAsset) : "";
    const receiveShown = quote ? displayAmount(quote.amountOut) : "";
    const canSwap = !!quote && canQuote && !searching && !paying;

    let action = "Swap";
    if (!distinct) action = "Select assets";
    else if (!payAmount.trim() || amountError) action = "Enter an amount";
    else if (searching || quoting) action = "Searching…";
    else if (quoteError) action = "No route";

    return (
        <div>
            <PageHeader
                title="Swap"
                description="Pay in one currency, get another back. Someone else sets the rate."
            />
            <Card className="mx-auto w-full max-w-md gap-0 overflow-hidden py-0">
                <div className="flex flex-col gap-4 p-4">
                    <AmountRow
                        label="From"
                        amount={payAmount}
                        onAmount={setPayAmount}
                        disabled={paying}
                        placeholder={
                            payPrecision === undefined
                                ? "0.0"
                                : amountPlaceholder(payPrecision)
                        }
                        assets={assets}
                        assetId={payAsset ?? undefined}
                        onAsset={(id) => {
                            setPayAsset(id);
                            writePair(id, receiveAsset);
                        }}
                    />
                    {amountError ? (
                        <p className="text-destructive -mt-2 text-xs">
                            {amountError}
                        </p>
                    ) : null}
                    <div className="relative flex justify-center">
                        <div className="absolute inset-0 flex items-center">
                            <Separator />
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            className="bg-background relative z-10 rounded-full [&_svg]:size-4"
                            aria-label="Switch assets"
                            disabled={paying}
                            onClick={() => {
                                setPayAsset(receiveAsset);
                                setReceiveAsset(payAsset);
                                writePair(receiveAsset, payAsset);
                                if (quote) setPayAmount(quote.amountOut);
                            }}
                        >
                            <ArrowDownUp />
                        </Button>
                    </div>
                    <AmountRow
                        label="To"
                        amount={receiveShown}
                        readOnly
                        disabled={paying}
                        placeholder={searching ? "Searching…" : "0.0"}
                        assets={assets}
                        assetId={receiveAsset ?? undefined}
                        onAsset={(id) => {
                            setReceiveAsset(id);
                            writePair(payAsset, id);
                        }}
                    />
                    {payAsset != null && payAsset === receiveAsset ? (
                        <p className="text-destructive text-sm">
                            Pick two different IOUs.
                        </p>
                    ) : null}
                    {quote && user && distinct ? (
                        <div className="bg-muted/30 space-y-3 rounded-lg border px-3 py-3">
                            <div className="text-muted-foreground flex justify-between gap-3 text-xs">
                                <span>Rate</span>
                                <span className="text-right font-mono">
                                    {displayAmount(quote.amountIn)} {paySymbol}{" "}
                                    → {displayAmount(quote.amountOut)}{" "}
                                    {receiveSymbol}
                                </span>
                            </div>
                            <PathRoute
                                user={user}
                                hops={quote.hops}
                                symbolOf={symbolOf}
                                labelOf={label}
                                className="border-0 bg-transparent px-0 py-0"
                            />
                        </div>
                    ) : null}
                    {quoteError ? (
                        <p
                            className="text-destructive text-sm break-words"
                            role="alert"
                        >
                            {quoteError}
                        </p>
                    ) : null}
                </div>
                <div className="border-t px-4 py-3">
                    <Button
                        type="button"
                        size="lg"
                        className="h-10 w-full text-sm font-semibold"
                        disabled={!canSwap}
                        onClick={() => {
                            if (!quote) return;
                            const sent = {
                                amount: payAmount,
                                payAsset,
                                receiveAsset,
                            };
                            pathPay.mutate(
                                {
                                    hops: quote.hops.map((hop) => ({
                                        account: hop.account,
                                        assetId: hop.assetId,
                                    })),
                                    amount: quote.amountIn,
                                    minReturn: quote.minReturn,
                                },
                                {
                                    onSuccess: () => {
                                        const now = draft.current;
                                        if (
                                            now.amount !== sent.amount ||
                                            now.payAsset !== sent.payAsset ||
                                            now.receiveAsset !== sent.receiveAsset
                                        ) {
                                            return;
                                        }
                                        setPayAmount("");
                                        setQuote(null);
                                    },
                                },
                            );
                        }}
                    >
                        {paying ? "Swapping…" : action}
                    </Button>
                </div>
            </Card>
        </div>
    );
}

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Check, ChevronDown, Loader2, XCircle } from "lucide-react";

import { defaultAssetId } from "@/components/asset-select";
import { AssetField } from "@/components/form-fields";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import {
    type PathHopQuote,
    usePathPay,
    usePayInvoice,
    useQuotePath,
} from "@/hooks/use-banx-mutations";
import { amountPlaceholder, displayAmount } from "@/lib/amount";
import { amountFieldValidator, useAppForm } from "@/lib/form";

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
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { toast } from "@shared/shadcn/ui/sonner";

type Hop = { account: string; assetId: number | undefined };

type QuoteSummary = {
    amountIn: string;
    amountOut: string;
    exactOut: boolean;
    hops: PathHopQuote[];
};

function feeIsPositive(fee: string | undefined): boolean {
    if (!fee) return false;
    const n = Number(fee);
    return Number.isFinite(n) ? n > 0 : displayAmount(fee) !== "0";
}

function parseAssetParam(
    params: URLSearchParams,
    key: string,
    assets: { id: number }[],
): number | undefined {
    const n = Number(params.get(key) || "");
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return assets.some((a) => a.id === n) ? n : undefined;
}

type FindValues = {
    payee: string;
    fromAsset: number | undefined;
    toAsset: number | undefined;
    maxHops: string;
    amount: string;
    feeMode: "send" | "receive";
};

function findQuoteKey(user: string, v: FindValues): string {
    return [
        user,
        v.payee.trim(),
        v.fromAsset ?? "",
        v.toAsset ?? "",
        v.amount.trim(),
        v.maxHops.trim() || "6",
        v.feeMode,
    ].join("|");
}

function canFindPath(
    user: string | null | undefined,
    v: FindValues,
): boolean {
    return (
        !!user &&
        !!v.payee.trim() &&
        v.fromAsset !== undefined &&
        v.toAsset !== undefined &&
        v.amount.trim() !== "" &&
        Number(v.amount) > 0
    );
}

function PathStatus({
    pending,
    found,
    failed,
    error,
    onRetry,
}: {
    pending: boolean;
    found: boolean;
    failed: boolean;
    error?: string | null;
    onRetry?: () => void;
}) {
    if (pending) {
        return (
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Loading
            </span>
        );
    }
    if (found) {
        return (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
                <Check className="size-4" strokeWidth={2.5} />
                Path Found
            </span>
        );
    }
    if (failed) {
        return (
            <button
                type="button"
                className="text-destructive inline-flex items-center gap-1.5 text-sm"
                title={error || "Path failure"}
                onClick={onRetry}
            >
                <XCircle className="size-4" />
                Path failure
            </button>
        );
    }
    return null;
}

/** Debounced auto-quote; also used so blur can flush immediately via `flush`. */
function AutoFindPath({
    quoteKey,
    enabled,
    onFind,
}: {
    quoteKey: string;
    enabled: boolean;
    onFind: () => void;
}) {
    const onFindRef = useRef(onFind);
    onFindRef.current = onFind;
    useEffect(() => {
        if (!enabled) return;
        const t = window.setTimeout(() => onFindRef.current(), 450);
        return () => window.clearTimeout(t);
    }, [quoteKey, enabled]);
    return null;
}

export function PathPayPage() {
    const { data: user } = useCurrentUser();
    const { assets, byId, precisionOf, symbolOf, isSuccess: assetsReady } =
        useAssetMap();
    const pathPay = usePathPay();
    const payInvoice = usePayInvoice();
    const quotePath = useQuotePath();
    const [searchParams] = useSearchParams();
    const requestId = Number(searchParams.get("request") || "0") || 0;

    const [quote, setQuote] = useState<QuoteSummary | null>(null);
    const [quotedKey, setQuotedKey] = useState<string | null>(null);
    const quotedKeyRef = useRef<string | null>(null);
    const [failedKey, setFailedKey] = useState<string | null>(null);
    const failedKeyRef = useRef<string | null>(null);
    const [quoteError, setQuoteError] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const quotingKeyRef = useRef<string | null>(null);
    const quoteSeq = useRef(0);

    const rememberQuotedKey = (key: string | null) => {
        quotedKeyRef.current = key;
        setQuotedKey(key);
    };
    const rememberFailedKey = (key: string | null) => {
        failedKeyRef.current = key;
        setFailedKey(key);
    };

    const findForm = useAppForm({
        defaultValues: {
            payee: searchParams.get("payee") ?? "",
            fromAsset: undefined as number | undefined,
            toAsset: undefined as number | undefined,
            maxHops: "6",
            amount: "1",
            /**
             * Fee mode:
             * - `send`  = exact-in: amount is what you send (payee covers fees)
             * - `receive` = exact-out: amount is what payee gets (you cover fees)
             */
            feeMode: (searchParams.get("request")
                ? "receive"
                : "send") as "send" | "receive",
        },
        onSubmit: async ({ value }) => {
            if (!canFindPath(user, value)) return;
            const key = findQuoteKey(user!, value);
            if (
                key === quotedKeyRef.current ||
                key === quotingKeyRef.current ||
                key === failedKeyRef.current
            ) {
                return;
            }
            quotingKeyRef.current = key;
            const seq = ++quoteSeq.current;
            const hopsN = Math.min(12, Math.max(1, Number(value.maxHops) || 6));
            // `receive` ⇒ you cover fees (exact-out). `send` ⇒ payee covers (exact-in).
            const exactOut = value.feeMode === "receive";
            const typedAmount = value.amount.trim();
            try {
                await new Promise<void>((resolve, reject) => {
                    quotePath.mutate(
                        {
                            fromAccount: user!,
                            toAccount: value.payee.trim(),
                            amount: typedAmount,
                            fromAsset: value.fromAsset!,
                            toAsset: value.toAsset!,
                            maxHops: hopsN,
                            exactOut,
                        },
                        {
                            onSuccess: (q) => {
                                if (seq !== quoteSeq.current) {
                                    resolve();
                                    return;
                                }
                                execForm.setFieldValue(
                                    "hops",
                                    q.hops.map((h) => ({
                                        account: h.account,
                                        assetId: h.assetId as
                                            | number
                                            | undefined,
                                    })),
                                );
                                execForm.setFieldValue(
                                    "amount",
                                    exactOut ? q.amountIn : typedAmount,
                                );
                                execForm.setFieldValue(
                                    "minReturn",
                                    exactOut ? q.minReturn : q.amountOut,
                                );
                                rememberQuotedKey(key);
                                rememberFailedKey(null);
                                setQuoteError(null);
                                setQuote({
                                    amountIn: exactOut
                                        ? q.amountIn
                                        : typedAmount,
                                    amountOut: q.amountOut,
                                    exactOut,
                                    hops: q.hops,
                                });
                                resolve();
                            },
                            onError: (e: Error) => {
                                if (seq === quoteSeq.current) {
                                    rememberQuotedKey(null);
                                    rememberFailedKey(key);
                                    setQuote(null);
                                    setQuoteError(e.message);
                                }
                                reject(e);
                            },
                        },
                    );
                });
            } finally {
                if (quotingKeyRef.current === key) {
                    quotingKeyRef.current = null;
                }
            }
        },
    });

    const execForm = useAppForm({
        defaultValues: {
            hops: [{ account: "", assetId: undefined }] as Hop[],
            amount: "1.00",
            minReturn: "0.01",
        },
        onSubmit: async ({ value }) => {
            const cleaned = value.hops
                .filter((h) => h.account.trim() && h.assetId !== undefined)
                .map((h) => ({
                    account: h.account.trim(),
                    assetId: h.assetId!,
                }));
            if (cleaned.length === 0) return;
            if (requestId) {
                const invoicePayee = (
                    searchParams.get("payee") ||
                    findForm.state.values.payee
                ).trim();
                const parsedAsset = Number(searchParams.get("toAsset") || "");
                const invoiceAsset =
                    Number.isFinite(parsedAsset) && parsedAsset > 0
                        ? parsedAsset
                        : findForm.state.values.toAsset;
                const last = cleaned[cleaned.length - 1];
                if (
                    !invoicePayee ||
                    invoiceAsset === undefined ||
                    last.account !== invoicePayee ||
                    last.assetId !== invoiceAsset
                ) {
                    toast.error(
                        "Last hop must be the invoice payee in the invoice asset",
                    );
                    return;
                }
            }
            await new Promise<void>((resolve, reject) => {
                if (requestId) {
                    payInvoice.mutate(
                        {
                            hops: cleaned,
                            maxSpend: value.amount.trim(),
                            requestId,
                        },
                        {
                            onSuccess: () => {
                                setConfirmOpen(false);
                                resolve();
                            },
                            onError: (e: Error) => reject(e),
                        },
                    );
                    return;
                }

                pathPay.mutate(
                    {
                        hops: cleaned,
                        amount: value.amount.trim(),
                        minReturn: value.minReturn.trim(),
                    },
                    {
                        onSuccess: () => {
                            setConfirmOpen(false);
                            resolve();
                        },
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    useEffect(() => {
        if (!assetsReady || assets.length === 0) return;
        const payee = searchParams.get("payee");
        const amount = searchParams.get("amount");
        const toAsset =
            parseAssetParam(searchParams, "toAsset", assets) ??
            defaultAssetId(assets);
        const fromAsset =
            parseAssetParam(searchParams, "fromAsset", assets) ?? toAsset;
        if (payee) findForm.setFieldValue("payee", payee);
        if (amount) {
            findForm.setFieldValue("amount", amount);
            execForm.setFieldValue("minReturn", amount);
            if (searchParams.get("request")) {
                execForm.setFieldValue("amount", amount);
            }
        }
        if (toAsset !== undefined) findForm.setFieldValue("toAsset", toAsset);
        if (fromAsset !== undefined) {
            findForm.setFieldValue("fromAsset", fromAsset);
        }
        if (searchParams.get("request")) {
            findForm.setFieldValue("feeMode", "receive");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, assetsReady, assets]);

    const addHop = () => {
        const hops = execForm.state.values.hops;
        const prevAsset = hops[hops.length - 1]?.assetId;
        execForm.setFieldValue("hops", [
            ...hops,
            {
                account: "",
                assetId: prevAsset ?? defaultAssetId(assets),
            },
        ]);
        // Hop list no longer matches the last quote fee breakdown.
        setQuote(null);
    };

    const removeLastHop = () => {
        const hops = execForm.state.values.hops;
        if (hops.length <= 1) return;
        execForm.setFieldValue("hops", hops.slice(0, -1));
        setQuote(null);
    };

    const findNow = () => {
        void findForm.handleSubmit().catch(() => undefined);
    };

    return (
        <div className="space-y-8">
            <PageHeader
                title="Transfer"
                description={
                    requestId
                        ? `Pay invoice #${requestId}. A path is quoted as you fill this in.`
                        : "Send along a path of credit. A route is quoted as you fill this in."
                }
            />

            <section className="grid max-w-2xl gap-4 rounded-lg border p-4">
                <findForm.Subscribe
                    selector={(s) => s.values}
                    children={(values) => (
                        <AutoFindPath
                            quoteKey={
                                user ? findQuoteKey(user, values) : ""
                            }
                            enabled={canFindPath(user, values)}
                            onFind={findNow}
                        />
                    )}
                />
                <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void findForm.handleSubmit();
                    }}
                >
                    <findForm.AppField
                        name="payee"
                        listeners={{
                            onBlur: () => findNow(),
                        }}
                        children={(field) => (
                            <field.TextField
                                label="Payee"
                                placeholder="brandon"
                            />
                        )}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                        <findForm.Field
                            name="fromAsset"
                            children={(field) => (
                                <AssetField
                                    label="From asset"
                                    assets={assets}
                                    value={field.state.value}
                                    onChange={(id) => field.handleChange(id)}
                                />
                            )}
                        />
                        <findForm.Field
                            name="toAsset"
                            children={(field) => (
                                <AssetField
                                    label="To asset"
                                    assets={assets}
                                    value={field.state.value}
                                    onChange={(id) => field.handleChange(id)}
                                />
                            )}
                        />
                    </div>
                    <findForm.Subscribe
                        selector={(s) => s.values.feeMode}
                        children={(feeMode) => (
                            <div className="grid gap-2">
                                <p className="text-sm font-medium">
                                    Amount means
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={
                                            feeMode === "send"
                                                ? "default"
                                                : "outline"
                                        }
                                        onClick={() => {
                                            findForm.setFieldValue(
                                                "feeMode",
                                                "send",
                                            );
                                            rememberQuotedKey(null);
                                            rememberFailedKey(null);
                                            setQuoteError(null);
                                            setQuote(null);
                                        }}
                                    >
                                        You send
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={
                                            feeMode === "receive"
                                                ? "default"
                                                : "outline"
                                        }
                                        onClick={() => {
                                            findForm.setFieldValue(
                                                "feeMode",
                                                "receive",
                                            );
                                            rememberQuotedKey(null);
                                            rememberFailedKey(null);
                                            setQuoteError(null);
                                            setQuote(null);
                                        }}
                                    >
                                        Payee receives
                                    </Button>
                                </div>
                                <p className="text-muted-foreground text-xs">
                                    {feeMode === "receive"
                                        ? "You cover hop fees — amount is what the payee gets; quote finds how much you send."
                                        : "Payee covers hop fees — amount is what you send; they receive less after fees."}
                                </p>
                            </div>
                        )}
                    />
                    <findForm.Subscribe
                        selector={(s) => ({
                            fromAsset: s.values.fromAsset,
                            toAsset: s.values.toAsset,
                            feeMode: s.values.feeMode,
                        })}
                        children={({ fromAsset, toAsset, feeMode }) => {
                            const amountAsset =
                                feeMode === "receive" ? toAsset : fromAsset;
                            const known =
                                amountAsset !== undefined &&
                                byId.has(amountAsset);
                            const precision = known
                                ? precisionOf(amountAsset)
                                : 0;
                            const amountLabel =
                                feeMode === "receive"
                                    ? "Payee receives"
                                    : "You send";
                            const amountValidators = known
                                ? {
                                      onChange: amountFieldValidator(
                                          precision,
                                          { allowZero: false },
                                      ),
                                      onSubmit: amountFieldValidator(
                                          precision,
                                          { allowZero: false },
                                      ),
                                  }
                                : undefined;
                            return (
                                <findForm.AppField
                                    name="amount"
                                    validators={amountValidators}
                                    listeners={{
                                        onBlur: () => findNow(),
                                    }}
                                    children={(field) => (
                                        <field.TextField
                                            label={amountLabel}
                                            inputMode="decimal"
                                            placeholder={amountPlaceholder(
                                                precision,
                                            )}
                                        />
                                    )}
                                />
                            );
                        }}
                    />
                    <findForm.Subscribe
                        selector={(s) => ({
                            fromAsset: s.values.fromAsset,
                            toAsset: s.values.toAsset,
                        })}
                        children={({ fromAsset, toAsset }) => {
                            if (!quote && !quotePath.isPending) return null;
                            const feeParts = quote
                                ? quote.hops.flatMap((h, i) => {
                                      const parts: string[] = [];
                                      if (feeIsPositive(h.hopFee)) {
                                          parts.push(
                                              `hop ${i + 1}: ${displayAmount(h.hopFee)} ${symbolOf(h.assetId)}`,
                                          );
                                      }
                                      if (
                                          feeIsPositive(h.fxFee) &&
                                          h.fxFromAsset !== undefined
                                      ) {
                                          parts.push(
                                              `FX→hop ${i + 1}: ${displayAmount(h.fxFee)} ${symbolOf(h.fxFromAsset)}`,
                                          );
                                      }
                                      return parts;
                                  })
                                : [];
                            return (
                                <div className="text-muted-foreground space-y-0.5 text-sm font-mono">
                                    {quote ? (
                                        <>
                                            <p>
                                                {quote.exactOut ? (
                                                    <>
                                                        You send:{" "}
                                                        {displayAmount(
                                                            quote.amountIn,
                                                        )}
                                                        {fromAsset !==
                                                        undefined
                                                            ? ` ${symbolOf(fromAsset)}`
                                                            : ""}
                                                        {" · "}
                                                        Payee gets ≥{" "}
                                                        {displayAmount(
                                                            quote.amountOut,
                                                        )}
                                                        {toAsset !== undefined
                                                            ? ` ${symbolOf(toAsset)}`
                                                            : ""}
                                                    </>
                                                ) : (
                                                    <>
                                                        You send:{" "}
                                                        {displayAmount(
                                                            quote.amountIn,
                                                        )}
                                                        {fromAsset !==
                                                        undefined
                                                            ? ` ${symbolOf(fromAsset)}`
                                                            : ""}
                                                        {" · "}
                                                        Est. out:{" "}
                                                        {displayAmount(
                                                            quote.amountOut,
                                                        )}
                                                        {toAsset !== undefined
                                                            ? ` ${symbolOf(toAsset)}`
                                                            : ""}
                                                    </>
                                                )}
                                            </p>
                                            <p className="text-xs">
                                                Expected fees:{" "}
                                                {feeParts.length > 0
                                                    ? feeParts.join(" · ")
                                                    : "none"}
                                            </p>
                                        </>
                                    ) : null}
                                </div>
                            );
                        }}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                        <findForm.Subscribe
                            selector={(s) => s.values}
                            children={(values) => (
                        <execForm.Subscribe
                            selector={(s) => s.values.hops}
                            children={(hops) => {
                                const key = user
                                    ? findQuoteKey(user, values)
                                    : "";
                                const live = !!key && quotedKey === key;
                                const failed = !!key && failedKey === key;
                                const ready =
                                    live &&
                                    hops.some(
                                        (h) =>
                                            h.account.trim() &&
                                            h.assetId !== undefined,
                                    );
                                return (
                                    <>
                                    <Button
                                        type="button"
                                        disabled={
                                            !ready ||
                                            pathPay.isPending ||
                                            payInvoice.isPending
                                        }
                                        onClick={() => setConfirmOpen(true)}
                                    >
                                        {requestId
                                            ? "Pay invoice"
                                            : "Transfer"}
                                    </Button>
                                    <PathStatus
                                        pending={quotePath.isPending}
                                        found={live}
                                        failed={failed}
                                        error={quoteError}
                                        onRetry={() => {
                                            rememberFailedKey(null);
                                            setQuoteError(null);
                                            findNow();
                                        }}
                                    />
                                    </>
                                );
                            }}
                        />
                            )}
                        />
                    </div>
                </form>

                <Collapsible
                    open={advancedOpen}
                    onOpenChange={setAdvancedOpen}
                >
                    <CollapsibleTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            className="text-muted-foreground h-8 w-full justify-between px-2 text-sm font-medium"
                        >
                            Advanced settings
                            <ChevronDown
                                className={cn(
                                    "size-4 transition-transform duration-200",
                                    advancedOpen && "rotate-180",
                                )}
                            />
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="grid gap-4 pt-3">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void execForm.handleSubmit();
                    }}
                    className="grid gap-4"
                >
                <findForm.AppField
                    name="maxHops"
                    listeners={{
                        onBlur: () => findNow(),
                    }}
                    children={(field) => (
                        <field.TextField
                            label="Max hops"
                            inputMode="numeric"
                        />
                    )}
                />
                <h3 className="text-sm font-medium">Hops &amp; execute</h3>
                <execForm.Subscribe
                    selector={(s) => s.values.hops}
                    children={(hops) => (
                        <div className="space-y-4">
                            {hops.map((hop, i) => {
                                // Fee annotations come from the last successful quote
                                // for this hop list (index-aligned while unedited).
                                const quoted = quote?.hops[i];
                                const sameHop =
                                    quoted &&
                                    quoted.account === hop.account.trim() &&
                                    quoted.assetId === hop.assetId;
                                const showFees = Boolean(sameHop);
                                const hopFee = quoted?.hopFee;
                                const fxFee = quoted?.fxFee;
                                const hasHopFee =
                                    showFees && feeIsPositive(hopFee);
                                const hasFxFee =
                                    showFees && feeIsPositive(fxFee);
                                const hopSym =
                                    hop.assetId !== undefined
                                        ? symbolOf(hop.assetId)
                                        : "";
                                const fxSym =
                                    quoted?.fxFromAsset !== undefined
                                        ? symbolOf(quoted.fxFromAsset)
                                        : "";
                                return (
                                    <div
                                        key={i}
                                        className="grid gap-2 rounded-md border p-3"
                                    >
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <execForm.AppField
                                                name={`hops[${i}].account`}
                                                children={(field) => (
                                                    <field.TextField
                                                        label={`Hop ${i + 1} account`}
                                                        placeholder={
                                                            i === 0
                                                                ? "gary"
                                                                : "steve"
                                                        }
                                                        required
                                                    />
                                                )}
                                            />
                                            <execForm.Field
                                                name={`hops[${i}].assetId`}
                                                children={(field) => (
                                                    <AssetField
                                                        assets={assets}
                                                        value={field.state.value}
                                                        onChange={(id) =>
                                                            field.handleChange(
                                                                id,
                                                            )
                                                        }
                                                    />
                                                )}
                                            />
                                        </div>
                                        {showFees ? (
                                            <div className="text-muted-foreground space-y-0.5 text-xs font-mono">
                                                {quoted?.amount ? (
                                                    <p>
                                                        After fees:{" "}
                                                        {displayAmount(
                                                            quoted.amount,
                                                        )}
                                                        {hopSym
                                                            ? ` ${hopSym}`
                                                            : ""}
                                                    </p>
                                                ) : null}
                                                {i === 0 &&
                                                !hasHopFee &&
                                                !hasFxFee ? (
                                                    <p>No hop fee (first hop)</p>
                                                ) : null}
                                                {hasHopFee ? (
                                                    <p>
                                                        Hop fee:{" "}
                                                        {displayAmount(
                                                            hopFee!,
                                                        )}
                                                        {hopSym
                                                            ? ` ${hopSym}`
                                                            : ""}
                                                    </p>
                                                ) : i > 0 && showFees ? (
                                                    <p>Hop fee: 0</p>
                                                ) : null}
                                                {hasFxFee ? (
                                                    <p>
                                                        FX fee:{" "}
                                                        {displayAmount(fxFee!)}
                                                        {fxSym
                                                            ? ` ${fxSym}`
                                                            : ""}
                                                    </p>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                />

                <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={addHop}>
                        Add hop
                    </Button>
                    <execForm.Subscribe
                        selector={(s) => s.values.hops.length}
                        children={(len) =>
                            len > 1 ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={removeLastHop}
                                >
                                    Remove last hop
                                </Button>
                            ) : null
                        }
                    />
                </div>

                <div
                    className={
                        requestId
                            ? "grid gap-2"
                            : "grid gap-2 sm:grid-cols-2 sm:gap-4"
                    }
                >
                    <execForm.Subscribe
                        selector={(s) => s.values.hops[0]?.assetId}
                        children={(firstAsset) => {
                            const known =
                                firstAsset !== undefined &&
                                byId.has(firstAsset);
                            const precision = known
                                ? precisionOf(firstAsset)
                                : 0;
                            const amountValidators = known
                                ? {
                                      onChange: amountFieldValidator(
                                          precision,
                                          { allowZero: false },
                                      ),
                                      onSubmit: amountFieldValidator(
                                          precision,
                                          { allowZero: false },
                                      ),
                                  }
                                : undefined;
                            return (
                                <execForm.AppField
                                    name="amount"
                                    validators={amountValidators}
                                    children={(field) => (
                                        <field.TextField
                                            label={
                                                requestId
                                                    ? "Max spend"
                                                    : "You send"
                                            }
                                            inputMode="decimal"
                                            placeholder={amountPlaceholder(
                                                precision,
                                            )}
                                            required
                                        />
                                    )}
                                />
                            );
                        }}
                    />
                    {requestId ? null : (
                        <execForm.Subscribe
                            selector={(s) =>
                                s.values.hops[s.values.hops.length - 1]
                                    ?.assetId
                            }
                            children={(lastAsset) => {
                                const known =
                                    lastAsset !== undefined &&
                                    byId.has(lastAsset);
                                const precision = known
                                    ? precisionOf(lastAsset)
                                    : 0;
                                const minValidators = known
                                    ? {
                                          onChange: amountFieldValidator(
                                              precision,
                                              { allowZero: true },
                                          ),
                                          onSubmit: amountFieldValidator(
                                              precision,
                                              { allowZero: true },
                                          ),
                                      }
                                    : undefined;
                                return (
                                    <execForm.AppField
                                        name="minReturn"
                                        validators={minValidators}
                                        children={(field) => (
                                            <field.TextField
                                                label="Payee min"
                                                inputMode="decimal"
                                                placeholder={amountPlaceholder(
                                                    precision,
                                                )}
                                                required
                                            />
                                        )}
                                    />
                                );
                            }}
                        />
                    )}
                </div>

                </form>
                    </CollapsibleContent>
                </Collapsible>

                <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>
                                {requestId
                                    ? "Confirm invoice payment"
                                    : "Confirm transfer"}
                            </DialogTitle>
                            <DialogDescription>
                                {quote ? (
                                    <>
                                        You send{" "}
                                        <span className="text-foreground font-medium">
                                            {displayAmount(quote.amountIn)}
                                        </span>
                                        {findForm.state.values.fromAsset !==
                                        undefined
                                            ? ` ${symbolOf(findForm.state.values.fromAsset)}`
                                            : ""}
                                        . Payee gets{" "}
                                        <span className="text-foreground font-medium">
                                            {displayAmount(quote.amountOut)}
                                        </span>
                                        {findForm.state.values.toAsset !==
                                        undefined
                                            ? ` ${symbolOf(findForm.state.values.toAsset)}`
                                            : ""}
                                        .
                                    </>
                                ) : (
                                    "Review the path, then confirm."
                                )}
                            </DialogDescription>
                        </DialogHeader>
                        <execForm.Subscribe
                            selector={(s) => s.values.hops}
                            children={(hops) => {
                                const path = hops.filter(
                                    (h) =>
                                        h.account.trim() &&
                                        h.assetId !== undefined,
                                );
                                if (path.length === 0) {
                                    return (
                                        <p className="text-muted-foreground text-sm">
                                            No hops on this path.
                                        </p>
                                    );
                                }
                                return (
                                    <ol className="space-y-2 text-sm">
                                        {path.map((h, i) => {
                                            const quoted = quote?.hops[i];
                                            const same =
                                                quoted &&
                                                quoted.account ===
                                                    h.account.trim() &&
                                                quoted.assetId === h.assetId;
                                            return (
                                                <li
                                                    key={`${h.account}-${h.assetId}-${i}`}
                                                    className="flex items-baseline justify-between gap-3"
                                                >
                                                    <span>
                                                        <span className="text-muted-foreground mr-2 font-mono text-xs">
                                                            {i + 1}.
                                                        </span>
                                                        <span className="font-medium">
                                                            {h.account.trim()}
                                                        </span>
                                                        <span className="text-muted-foreground">
                                                            {" "}
                                                            ·{" "}
                                                            {symbolOf(
                                                                h.assetId!,
                                                            )}
                                                        </span>
                                                    </span>
                                                    {same && quoted?.amount ? (
                                                        <span className="text-muted-foreground font-mono text-xs">
                                                            {displayAmount(
                                                                quoted.amount,
                                                            )}
                                                        </span>
                                                    ) : null}
                                                </li>
                                            );
                                        })}
                                    </ol>
                                );
                            }}
                        />
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setConfirmOpen(false)}
                                disabled={
                                    pathPay.isPending || payInvoice.isPending
                                }
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                disabled={
                                    pathPay.isPending || payInvoice.isPending
                                }
                                onClick={() => void execForm.handleSubmit()}
                            >
                                {pathPay.isPending || payInvoice.isPending
                                    ? requestId
                                        ? "Paying…"
                                        : "Submitting…"
                                    : requestId
                                      ? "Pay invoice"
                                      : "Transfer"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </section>
        </div>
    );
}

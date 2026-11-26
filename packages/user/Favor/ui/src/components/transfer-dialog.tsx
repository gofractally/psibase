import { useEffect, useRef, useState } from "react";

import { ChevronDown, Loader2, QrCode, XCircle } from "lucide-react";

import { defaultAssetId } from "@/components/asset-select";
import { AssetField, amountUnit } from "@/components/form-fields";
import { TransferQrDialog } from "@/components/transfer-qr-dialog";
import { useAssetMap } from "@/hooks/use-assets";
import {
    usePathPay,
    usePayInvoice,
    useQuotePath,
} from "@/hooks/use-favor-mutations";
import {
    amountPlaceholder,
    displayAmount,
    formatRawAmount,
    humanToRaw,
} from "@/lib/amount";
import { amountFieldValidator, useAppForm } from "@/lib/form";
import {
    assetIdBySymbol,
    transferSuggestUrl,
    type TransferPrefill,
} from "@/lib/transfer-url";

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

/** Amounts are raw ledger units. The form fields hold decimals, converted with these precisions. */
type QuoteSummary = {
    route: string;
    amountIn: string;
    amountOut: string;
    minReturn: string;
    hopCount: number;
    fromPrecision: number;
    toPrecision: number;
};

/** Caption under the amount. The typed amount is what the payee receives. */
function transferCostNote(
    quote: QuoteSummary,
    fromAsset: number | undefined,
    toAsset: number | undefined,
    symbolOf: (id: number) => string,
    precisionOf: (id: number) => number,
): string | null {
    if (fromAsset === undefined || toAsset === undefined) return null;
    const precision = precisionOf(fromAsset);
    const send = `${formatRawAmount(quote.amountIn, precision)} ${symbolOf(fromAsset)}`;
    if (fromAsset !== toAsset) {
        return quote.hopCount > 1
            ? `Private path · you send ${send}`
            : `Conversion · you send ${send}`;
    }
    const extra = BigInt(quote.amountIn) - BigInt(quote.amountOut);
    if (extra <= 0n) return null;
    return `Fee ${formatRawAmount(extra.toString(), precision)} ${symbolOf(fromAsset)}`;
}

export type { TransferPrefill } from "@/lib/transfer-url";
export { transferPrefillFromSearch } from "@/lib/transfer-url";

function parseAssetId(
    id: number | undefined,
    assets: { id: number }[],
): number | undefined {
    if (id === undefined || !Number.isFinite(id) || id <= 0) return undefined;
    return assets.some((a) => a.id === id) ? id : undefined;
}

type FindValues = {
    payee: string;
    fromAsset: number | undefined;
    toAsset: number | undefined;
    maxHops: string;
    amount: string;
};

function findQuoteKey(user: string, v: FindValues): string {
    return [
        user,
        v.payee.trim(),
        v.fromAsset ?? "",
        v.toAsset ?? "",
        v.amount.trim(),
        v.maxHops.trim() || "6",
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

type ExecValues = {
    route: string;
    amount: string;
    minReturn: string;
};

/** Payment is allowed only while the exec form still is the stored quote. */
function quoteMatchesExec(
    quote: QuoteSummary | null,
    exec: ExecValues,
    invoice: boolean,
): boolean {
    if (!quote || !quote.route) return false;
    if (exec.route !== quote.route) return false;
    if (humanToRaw(exec.amount, quote.fromPrecision).toString() !== quote.amountIn) {
        return false;
    }
    if (
        !invoice &&
        humanToRaw(exec.minReturn, quote.toPrecision).toString() !==
            quote.minReturn
    ) {
        return false;
    }
    return true;
}

function quoteStillCurrent(
    user: string | null | undefined,
    find: FindValues,
    quotedKey: string | null,
    quote: QuoteSummary | null,
    exec: ExecValues,
    invoice: boolean,
): boolean {
    if (!user || quotedKey === null) return false;
    return (
        quotedKey === findQuoteKey(user, find) &&
        quoteMatchesExec(quote, exec, invoice)
    );
}

const QUOTE_STALE =
    "The path changed since it was quoted. Search again before sending.";

function PathStatus({
    pending,
    failed,
    error,
    onRetry,
}: {
    pending: boolean;
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

export function TransferDialog({
    open,
    onOpenChange,
    prefill,
    defaultAsset,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    prefill?: TransferPrefill | null;
    /** Accounts passes the selected currency. That locks From, which is not shown. To defaults to it and is edited under Advanced. */
    defaultAsset?: number;
}) {
    const { data: user } = useCurrentUser();
    const { assets, byId, precisionOf, symbolOf, isSuccess: assetsReady } =
        useAssetMap();
    // Present only on the accounts page, where the header already chose the currency.
    const lockedFrom = parseAssetId(defaultAsset, assets);
    const currencyWanted = prefill?.currency?.trim() ?? "";
    const pinnedId = assetIdBySymbol(currencyWanted || undefined, assets);
    const currencyUnresolved =
        assetsReady &&
        assets.length > 0 &&
        currencyWanted !== "" &&
        pinnedId === undefined;
    const pathPay = usePathPay();
    const payInvoice = usePayInvoice();
    const quotePath = useQuotePath();
    const requestId = prefill?.requestId && prefill.requestId > 0
        ? prefill.requestId
        : 0;

    const [quote, setQuote] = useState<QuoteSummary | null>(null);
    const [quotedKey, setQuotedKey] = useState<string | null>(null);
    const quotedKeyRef = useRef<string | null>(null);
    const quoteRef = useRef<QuoteSummary | null>(null);
    quoteRef.current = quote;
    const requestIdRef = useRef(requestId);
    requestIdRef.current = requestId;
    const userRef = useRef(user);
    userRef.current = user;
    const [failedKey, setFailedKey] = useState<string | null>(null);
    const failedKeyRef = useRef<string | null>(null);
    const [quoteError, setQuoteError] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [qrOpen, setQrOpen] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const quotingKeyRef = useRef<string | null>(null);
    const quoteSeq = useRef(0);
    const currencyUnresolvedRef = useRef(currencyUnresolved);
    currencyUnresolvedRef.current = currencyUnresolved;
    const clearAfterPayRef = useRef<() => void>(() => {});
    const minEditedRef = useRef(false);
    const minSyncedRef = useRef("");

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
            payee: prefill?.payee ?? "",
            fromAsset: undefined as number | undefined,
            toAsset: undefined as number | undefined,
            maxHops: "6",
            amount: prefill?.amount ?? "",
        },
        onSubmit: async ({ value }) => {
            if (currencyUnresolvedRef.current) return;
            if (!canFindPath(user, value)) return;
            const key = findQuoteKey(user!, value);
            if (
                key === quotingKeyRef.current ||
                key === failedKeyRef.current
            ) {
                return;
            }
            if (
                key === quotedKeyRef.current &&
                quoteMatchesExec(
                    quoteRef.current,
                    execForm.state.values,
                    requestIdRef.current > 0,
                )
            ) {
                return;
            }
            quotingKeyRef.current = key;
            const seq = ++quoteSeq.current;
            const hopsN = Math.min(12, Math.max(1, Number(value.maxHops) || 6));
            rememberQuotedKey(null);
            rememberFailedKey(null);
            setQuoteError(null);
            setQuote(null);
            execForm.setFieldValue("route", "");
            try {
                await new Promise<void>((resolve, reject) => {
                    quotePath.mutate(
                        {
                            fromAccount: user!,
                            toAccount: value.payee.trim(),
                            amount: value.amount.trim(),
                            fromAsset: value.fromAsset!,
                            toAsset: value.toAsset!,
                            maxHops: hopsN,
                            exactOut: true,
                        },
                        {
                            onSuccess: (q) => {
                                if (seq !== quoteSeq.current) {
                                    resolve();
                                    return;
                                }
                                execForm.setFieldValue("route", q.route);
                                const fromPrecision = precisionOf(value.fromAsset!);
                                const toPrecision = precisionOf(value.toAsset!);
                                const minShown = formatRawAmount(
                                    q.minReturn,
                                    toPrecision,
                                );
                                execForm.setFieldValue(
                                    "amount",
                                    formatRawAmount(q.amountIn, fromPrecision),
                                );
                                minSyncedRef.current = minShown;
                                execForm.setFieldValue("minReturn", minShown);
                                rememberQuotedKey(key);
                                rememberFailedKey(null);
                                setQuoteError(null);
                                setQuote({
                                    route: q.route,
                                    amountIn: q.amountIn,
                                    amountOut: q.amountOut,
                                    minReturn: q.minReturn,
                                    hopCount: q.hopCount ?? 0,
                                    fromPrecision,
                                    toPrecision,
                                });
                                resolve();
                            },
                            onError: (e: Error) => {
                                if (seq === quoteSeq.current) {
                                    rememberQuotedKey(null);
                                    rememberFailedKey(key);
                                    setQuote(null);
                                    setQuoteError(e.message);
                                    execForm.setFieldValue("route", "");
                                    execForm.setFieldValue("amount", "");
                                    minSyncedRef.current = "";
                                    execForm.setFieldValue("minReturn", "");
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
            route: "",
            amount: "",
            minReturn: "",
        },
        onSubmit: async ({ value }) => {
            if (currencyUnresolvedRef.current) {
                toast.error("This link's currency is not available.");
                setConfirmOpen(false);
                return;
            }
            if (
                !quoteStillCurrent(
                    userRef.current,
                    findForm.state.values,
                    quotedKeyRef.current,
                    quoteRef.current,
                    value,
                    requestIdRef.current > 0,
                )
            ) {
                toast.error(QUOTE_STALE);
                setConfirmOpen(false);
                return;
            }
            const sealed = quoteRef.current;
            if (!value.route || !sealed) return;
            const rawAmount = humanToRaw(
                value.amount,
                sealed.fromPrecision,
            ).toString();
            const rawMin = humanToRaw(
                value.minReturn,
                sealed.toPrecision,
            ).toString();
            await new Promise<void>((resolve, reject) => {
                if (requestId) {
                    payInvoice.mutate(
                        {
                            route: value.route,
                            maxSpend: rawAmount,
                            requestId,
                        },
                        {
                            onSuccess: () => {
                                clearAfterPayRef.current();
                                resolve();
                            },
                            onError: (e: Error) => reject(e),
                        },
                    );
                    return;
                }

                pathPay.mutate(
                    {
                        route: value.route,
                        amount: rawAmount,
                        minReturn: rawMin,
                    },
                    {
                        onSuccess: () => {
                            clearAfterPayRef.current();
                            resolve();
                        },
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    const followMin = (next: string) => {
        if (minEditedRef.current) return;
        minSyncedRef.current = next;
        execForm.setFieldValue("minReturn", next);
    };

    useEffect(() => {
        if (!open || !assetsReady || assets.length === 0) return;
        const payee = prefill?.payee;
        const amount = prefill?.amount?.trim() ?? "";
        minEditedRef.current = false;
        minSyncedRef.current = amount;
        // `currency=usd` is a suggested transfer: both sides use it.
        // Otherwise a set page currency wins over an invoice's from-asset.
        // An unknown symbol does not use either fallback.
        const wanted = prefill?.currency?.trim() ?? "";
        const pinned = assetIdBySymbol(wanted || undefined, assets);
        const unresolved = wanted !== "" && pinned === undefined;
        const toAsset = unresolved
            ? undefined
            : (pinned ??
              parseAssetId(prefill?.toAsset, assets) ??
              lockedFrom ??
              defaultAssetId(assets));
        const fromAsset = unresolved
            ? undefined
            : (pinned ??
              lockedFrom ??
              parseAssetId(prefill?.fromAsset, assets) ??
              toAsset);
        findForm.setFieldValue("payee", payee?.trim() ?? "");
        findForm.setFieldValue("amount", amount);
        execForm.setFieldValue("amount", requestId && amount ? amount : "");
        execForm.setFieldValue("minReturn", amount);
        findForm.setFieldValue("toAsset", toAsset);
        findForm.setFieldValue("fromAsset", fromAsset);
        rememberQuotedKey(null);
        rememberFailedKey(null);
        setQuoteError(null);
        setQuote(null);
        setConfirmOpen(false);
        setAdvancedOpen(false);
        quotingKeyRef.current = null;
        quoteSeq.current += 1;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, prefill, assetsReady, assets, requestId, defaultAsset, lockedFrom]);

    const clearAfterPay = () => {
        setConfirmOpen(false);
        rememberQuotedKey(null);
        rememberFailedKey(null);
        setQuoteError(null);
        setQuote(null);
        quotingKeyRef.current = null;
        quoteSeq.current += 1;
        findForm.setFieldValue("amount", "");
        minEditedRef.current = false;
        minSyncedRef.current = "";
        findForm.setFieldMeta("amount", (prev) => ({
            ...prev,
            errors: [],
            errorMap: {},
            isTouched: false,
            isDirty: false,
        }));
        execForm.setFieldValue("route", "");
        execForm.setFieldValue("amount", "");
        execForm.setFieldValue("minReturn", "");
        onOpenChange(false);
    };
    clearAfterPayRef.current = clearAfterPay;

    const findNow = () => {
        void findForm.handleSubmit().catch(() => undefined);
    };

    const pinnedSymbol =
        pinnedId !== undefined ? symbolOf(pinnedId) : undefined;
    const quotedFrom = findForm.state.values.fromAsset;
    const quotedTo = findForm.state.values.toAsset;
    const confirmNote = quote
        ? transferCostNote(quote, quotedFrom, quotedTo, symbolOf, precisionOf)
        : null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] flex-col sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {requestId ? `Pay invoice #${requestId}` : "Transfer"}
                    </DialogTitle>
                    <DialogDescription
                        className={
                            currencyUnresolved ? "text-destructive" : undefined
                        }
                    >
                        {currencyUnresolved
                            ? `No currency named ${currencyWanted.toUpperCase()}. This transfer will not use another currency.`
                            : requestId
                              ? "A path is quoted as you fill this in."
                              : pinnedSymbol
                                ? `Send along a path of credit in ${pinnedSymbol}. A route is quoted as you fill this in.`
                                : "Send along a path of credit. A route is quoted as you fill this in."}
                    </DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                <findForm.Subscribe
                    selector={(s) => s.values}
                    children={(values) => (
                        <AutoFindPath
                            quoteKey={
                                user ? findQuoteKey(user, values) : ""
                            }
                            enabled={
                                canFindPath(user, values) && !currencyUnresolved
                            }
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
                                placeholder="account"
                            />
                        )}
                    />
                    {lockedFrom === undefined ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <findForm.Field
                                name="fromAsset"
                                children={(field) => (
                                    <AssetField
                                        label="From asset"
                                        assets={assets}
                                        value={field.state.value}
                                        onChange={(id) =>
                                            field.handleChange(id)
                                        }
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
                                        onChange={(id) =>
                                            field.handleChange(id)
                                        }
                                    />
                                )}
                            />
                        </div>
                    ) : null}
                    <findForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) => {
                            const amountAsset = values.toAsset;
                            const known =
                                amountAsset !== undefined &&
                                byId.has(amountAsset);
                            const precision = known
                                ? precisionOf(amountAsset)
                                : 0;
                            const amountSymbol = known
                                ? symbolOf(amountAsset)
                                : undefined;
                            const amountValidators = known
                                ? {
                                      onChange: amountFieldValidator(
                                          precision,
                                          {
                                              allowEmpty: true,
                                              allowZero: false,
                                          },
                                      ),
                                      onSubmit: amountFieldValidator(
                                          precision,
                                          {
                                              allowEmpty: true,
                                              allowZero: false,
                                          },
                                      ),
                                  }
                                : undefined;
                            const note =
                                user &&
                                quote &&
                                quotedKey === findQuoteKey(user, values)
                                    ? transferCostNote(
                                          quote,
                                          values.fromAsset,
                                          values.toAsset,
                                          symbolOf,
                                          precisionOf,
                                      )
                                    : null;
                            return (
                                <div className="grid gap-2">
                                    <findForm.AppField
                                        name="amount"
                                        validators={amountValidators}
                                        listeners={{
                                            onChange: ({ value }) => {
                                                followMin(String(value ?? ""));
                                            },
                                            onBlur: () => findNow(),
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label="Amount"
                                                inputMode="decimal"
                                                placeholder={amountPlaceholder(
                                                    precision,
                                                )}
                                                endContent={amountUnit(
                                                    amountSymbol,
                                                )}
                                            />
                                        )}
                                    />
                                    {note ? (
                                        <p className="text-muted-foreground text-sm">
                                            {note}
                                        </p>
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
                            selector={(s) => s.values}
                            children={(exec) => {
                                const key = user
                                    ? findQuoteKey(user, values)
                                    : "";
                                const found = quoteStillCurrent(
                                    user,
                                    values,
                                    quotedKey,
                                    quote,
                                    exec,
                                    requestId > 0,
                                );
                                const failed = !!key && failedKey === key;
                                const ready = found && !!exec.route;
                                const suggestAsset =
                                    values.toAsset ?? values.fromAsset;
                                const suggestSymbol =
                                    suggestAsset !== undefined &&
                                    byId.has(suggestAsset)
                                        ? symbolOf(suggestAsset)
                                        : "";
                                const suggestUrl = requestId
                                    ? null
                                    : transferSuggestUrl(
                                          values.payee,
                                          values.amount,
                                          suggestSymbol,
                                      );
                                return (
                                    <>
                                    <Button
                                        type="button"
                                        disabled={
                                            !ready ||
                                            currencyUnresolved ||
                                            pathPay.isPending ||
                                            payInvoice.isPending
                                        }
                                        onClick={() => setConfirmOpen(true)}
                                    >
                                        {requestId
                                            ? "Pay invoice"
                                            : "Transfer"}
                                    </Button>
                                    {requestId ? null : (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="gap-2"
                                            disabled={!suggestUrl}
                                            onClick={() => setQrOpen(true)}
                                        >
                                            <QrCode className="size-4" />
                                            QR
                                        </Button>
                                    )}
                                    <TransferQrDialog
                                        open={qrOpen && !requestId}
                                        onOpenChange={setQrOpen}
                                        url={suggestUrl}
                                        payee={values.payee.trim()}
                                        amount={values.amount.trim()}
                                        symbol={suggestSymbol}
                                    />
                                    <PathStatus
                                        pending={quotePath.isPending}
                                        failed={failed}
                                        error={quoteError}
                                        onRetry={() => {
                                            rememberFailedKey(null);
                                            setQuoteError(null);
                                            findNow();
                                        }}
                                    />
                                    {found && quote ? (
                                        <p className="text-muted-foreground basis-full text-sm">
                                            Private path, {quote.hopCount}{" "}
                                            {quote.hopCount === 1 ? "hop" : "hops"}.
                                            Intermediaries are not shown.
                                        </p>
                                    ) : null}
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
                        if (currencyUnresolved) return;
                        if (
                            !quoteStillCurrent(
                                user,
                                findForm.state.values,
                                quotedKeyRef.current,
                                quoteRef.current,
                                execForm.state.values,
                                requestIdRef.current > 0,
                            )
                        ) {
                            toast.error(QUOTE_STALE);
                            return;
                        }
                        setConfirmOpen(true);
                    }}
                    className="grid gap-4"
                >
                {lockedFrom !== undefined ? (
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
                ) : null}
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
                <div
                    className={
                        requestId
                            ? "grid gap-2"
                            : "grid gap-2 sm:grid-cols-2 sm:gap-4"
                    }
                >
                    <findForm.Subscribe
                        selector={(s) => s.values.fromAsset}
                        children={(fromAsset) => (
                            <execForm.Subscribe
                                selector={(s) => s.values.route}
                                children={() => {
                                    const sendAsset = fromAsset;
                                    const known =
                                        sendAsset !== undefined &&
                                        byId.has(sendAsset);
                                    const precision = known
                                        ? precisionOf(sendAsset)
                                        : 0;
                                    const amountValidators = known
                                        ? {
                                              onChange: amountFieldValidator(
                                                  precision,
                                                  {
                                                      allowEmpty: true,
                                                      allowZero: false,
                                                  },
                                              ),
                                              onSubmit: amountFieldValidator(
                                                  precision,
                                                  {
                                                      allowEmpty: true,
                                                      allowZero: false,
                                                  },
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
                                                    endContent={amountUnit(
                                                        known
                                                            ? symbolOf(
                                                                  sendAsset,
                                                              )
                                                            : undefined,
                                                    )}
                                                />
                                            )}
                                        />
                                    );
                                }}
                            />
                        )}
                    />
                    {requestId ? null : (
                        <findForm.Subscribe
                            selector={(s) => s.values.toAsset}
                            children={(toAsset) => (
                        <execForm.Subscribe
                            selector={(s) => s.values.route}
                            children={() => {
                                const receiveAsset = toAsset;
                                const known =
                                    receiveAsset !== undefined &&
                                    byId.has(receiveAsset);
                                const precision = known
                                    ? precisionOf(receiveAsset)
                                    : 0;
                                const minValidators = known
                                    ? {
                                          onChange: amountFieldValidator(
                                              precision,
                                              {
                                                  allowEmpty: true,
                                                  allowZero: true,
                                              },
                                          ),
                                          onSubmit: amountFieldValidator(
                                              precision,
                                              {
                                                  allowEmpty: true,
                                                  allowZero: true,
                                              },
                                          ),
                                      }
                                    : undefined;
                                return (
                                    <execForm.AppField
                                        name="minReturn"
                                        validators={minValidators}
                                        listeners={{
                                            onChange: ({ value }) => {
                                                if (
                                                    String(value ?? "") !==
                                                    minSyncedRef.current
                                                ) {
                                                    minEditedRef.current = true;
                                                }
                                            },
                                        }}
                                        children={(field) => (
                                            <field.TextField
                                                label="Payee min"
                                                inputMode="decimal"
                                                placeholder={amountPlaceholder(
                                                    precision,
                                                )}
                                                endContent={amountUnit(
                                                    known
                                                        ? symbolOf(
                                                              receiveAsset,
                                                          )
                                                        : undefined,
                                                )}
                                            />
                                        )}
                                    />
                                );
                            }}
                        />
                            )}
                        />
                    )}
                </div>

                </form>
                    </CollapsibleContent>
                </Collapsible>

                <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                    <DialogContent className="sm:max-w-xl">
                        <DialogHeader>
                            <DialogTitle>
                                {requestId
                                    ? "Confirm invoice payment"
                                    : "Confirm transfer"}
                            </DialogTitle>
                            <DialogDescription>
                                <execForm.Subscribe
                                    selector={(s) => s.values}
                                    children={(exec) => {
                                        const matched = quoteStillCurrent(
                                            user,
                                            findForm.state.values,
                                            quotedKey,
                                            quote,
                                            exec,
                                            requestId > 0,
                                        );
                                        if (!matched || !quote) {
                                            return QUOTE_STALE;
                                        }
                                        const sendAsset =
                                            findForm.state.values.fromAsset;
                                        const receiveAsset =
                                            findForm.state.values.toAsset;
                                        return (
                                            <>
                                                You send{" "}
                                                <span className="text-foreground font-medium">
                                                    {displayAmount(exec.amount)}
                                                </span>
                                                {sendAsset !== undefined
                                                    ? ` ${symbolOf(sendAsset)}`
                                                    : ""}
                                                . Payee gets{" "}
                                                <span className="text-foreground font-medium">
                                                    {formatRawAmount(
                                                        quote.amountOut,
                                                        receiveAsset !== undefined
                                                            ? precisionOf(receiveAsset)
                                                            : 0,
                                                    )}
                                                </span>
                                                {receiveAsset !== undefined
                                                    ? ` ${symbolOf(receiveAsset)}`
                                                    : ""}
                                                .
                                                {confirmNote
                                                    ? ` ${confirmNote}.`
                                                    : ""}
                                            </>
                                        );
                                    }}
                                />
                            </DialogDescription>
                        </DialogHeader>
                        <execForm.Subscribe
                            selector={(s) => s.values}
                            children={(exec) => {
                                const matched = quoteStillCurrent(
                                    user,
                                    findForm.state.values,
                                    quotedKey,
                                    quote,
                                    exec,
                                    requestId > 0,
                                );
                                if (!matched || !quote) return null;
                                return (
                                    <p className="text-muted-foreground text-sm">
                                        Private path, {quote.hopCount}{" "}
                                        {quote.hopCount === 1
                                            ? "hop"
                                            : "hops"}.
                                    </p>
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
                            <execForm.Subscribe
                                selector={(s) => s.values}
                                children={(exec) => {
                                    const matched = quoteStillCurrent(
                                        user,
                                        findForm.state.values,
                                        quotedKey,
                                        quote,
                                        exec,
                                        requestId > 0,
                                    );
                                    return (
                                        <Button
                                            type="button"
                                            disabled={
                                                !matched ||
                                                currencyUnresolved ||
                                                pathPay.isPending ||
                                                payInvoice.isPending
                                            }
                                            onClick={() =>
                                                void execForm.handleSubmit()
                                            }
                                        >
                                            {pathPay.isPending ||
                                            payInvoice.isPending
                                                ? requestId
                                                    ? "Paying…"
                                                    : "Submitting…"
                                                : requestId
                                                  ? "Pay invoice"
                                                  : "Transfer"}
                                        </Button>
                                    );
                                }}
                            />
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
                </div>
            </DialogContent>
        </Dialog>
    );
}

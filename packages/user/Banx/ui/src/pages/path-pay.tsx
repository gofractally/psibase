import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
    defaultAssetId,
} from "@/components/asset-select";
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
import { Button } from "@shared/shadcn/ui/button";
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
            if (
                !user ||
                !value.payee.trim() ||
                value.fromAsset === undefined ||
                value.toAsset === undefined
            )
                return;
            const hopsN = Math.min(12, Math.max(1, Number(value.maxHops) || 6));
            // `receive` ⇒ you cover fees (exact-out). `send` ⇒ payee covers (exact-in).
            const exactOut = value.feeMode === "receive";
            const typedAmount = value.amount.trim();
            await new Promise<void>((resolve, reject) => {
                quotePath.mutate(
                    {
                        fromAccount: user,
                        toAccount: value.payee.trim(),
                        amount: typedAmount,
                        fromAsset: value.fromAsset!,
                        toAsset: value.toAsset!,
                        maxHops: hopsN,
                        exactOut,
                    },
                    {
                        onSuccess: (q) => {
                            execForm.setFieldValue(
                                "hops",
                                q.hops.map((h) => ({
                                    account: h.account,
                                    assetId: h.assetId as number | undefined,
                                })),
                            );
                            // Exact-in: trust the typed send amount.
                            // Exact-out: use quoted send (includes fee buffer).
                            execForm.setFieldValue(
                                "amount",
                                exactOut ? q.amountIn : typedAmount,
                            );
                            execForm.setFieldValue(
                                "minReturn",
                                exactOut ? q.minReturn : q.amountOut,
                            );
                            setQuote({
                                amountIn: exactOut ? q.amountIn : typedAmount,
                                amountOut: q.amountOut,
                                exactOut,
                                hops: q.hops,
                            });
                            resolve();
                        },
                        onError: (e: Error) => reject(e),
                    },
                );
            });
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
                            onSuccess: () => resolve(),
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
                        onSuccess: () => resolve(),
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

    return (
        <div className="space-y-8">
            <PageHeader
                title="Transfer"
                description="Pay along hops. First hop: credit line or reverse claim. Later hops: live path-forward. Find path fills the list."
            />

            <section className="grid max-w-2xl gap-4 rounded-lg border p-4">
                <h2 className="font-medium">
                    Find path
                    {requestId
                        ? ` · invoice #${requestId}`
                        : null}
                </h2>
                <p className="text-muted-foreground text-xs">
                    Off-chain quote using credit lines, path-forward offers, and FX
                    policies expanded from your account toward the payee (not a
                    full network dump). Fills the hop list below; you can still
                    edit hops before paying.
                </p>
                <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void findForm.handleSubmit();
                    }}
                >
                    <div className="grid gap-3 sm:grid-cols-2">
                        <findForm.AppField
                            name="payee"
                            children={(field) => (
                                <field.TextField
                                    label="Payee"
                                    placeholder="brandon"
                                />
                            )}
                        />
                        <findForm.AppField
                            name="maxHops"
                            children={(field) => (
                                <field.TextField
                                    label="Max hops"
                                    inputMode="numeric"
                                />
                            )}
                        />
                    </div>
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
                                <p className="text-sm font-medium">Amount means</p>
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
                            // receive (you cover) ⇒ amount in to-asset; send ⇒ from-asset
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
                    <div className="flex flex-wrap items-center gap-3">
                        <findForm.Subscribe
                            selector={(s) => s.values}
                            children={(values) => (
                                <findForm.AppForm>
                                    <findForm.SubmitButton
                                        labels={["Find path", "Searching…"]}
                                        loading={quotePath.isPending}
                                        disabled={
                                            !user ||
                                            !values.payee.trim() ||
                                            values.fromAsset === undefined ||
                                            values.toAsset === undefined
                                        }
                                    />
                                </findForm.AppForm>
                            )}
                        />
                        <findForm.Subscribe
                            selector={(s) => ({
                                fromAsset: s.values.fromAsset,
                                toAsset: s.values.toAsset,
                            })}
                            children={({ fromAsset, toAsset }) => {
                                if (!quote) return null;
                                const feeParts = quote.hops.flatMap((h, i) => {
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
                                });
                                return (
                                    <div className="text-muted-foreground space-y-0.5 text-sm font-mono">
                                        <p>
                                            {quote.exactOut ? (
                                                <>
                                                    You send:{" "}
                                                    {displayAmount(
                                                        quote.amountIn,
                                                    )}
                                                    {fromAsset !== undefined
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
                                                    {fromAsset !== undefined
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
                                        {feeParts.length > 0 ? (
                                            <p className="text-xs">
                                                Expected fees:{" "}
                                                {feeParts.join(" · ")}
                                            </p>
                                        ) : (
                                            <p className="text-xs">
                                                Expected fees: none
                                            </p>
                                        )}
                                    </div>
                                );
                            }}
                        />
                    </div>
                </form>
            </section>

            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void execForm.handleSubmit();
                }}
                className="grid max-w-2xl gap-4 rounded-lg border p-4"
            >
                <h2 className="font-medium">Hops &amp; execute</h2>
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

                <execForm.AppForm>
                    <execForm.SubmitButton
                        labels={
                            requestId
                                ? ["Pay invoice", "Paying…"]
                                : ["Transfer", "Submitting…"]
                        }
                        loading={pathPay.isPending || payInvoice.isPending}
                    />
                </execForm.AppForm>
            </form>
        </div>
    );
}

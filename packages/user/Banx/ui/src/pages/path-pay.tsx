import { useState } from "react";

import {
    defaultAssetId,
} from "@/components/asset-select";
import { AssetField } from "@/components/form-fields";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import { usePathPay, useQuotePath } from "@/hooks/use-banx-mutations";
import { amountPlaceholder } from "@/lib/amount";
import { useAppForm } from "@/lib/form";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";

type Hop = { account: string; assetId: number | undefined };

export function PathPayPage() {
    const { data: user } = useCurrentUser();
    const { assets, precisionOf, symbolOf } = useAssetMap();
    const pathPay = usePathPay();
    const quotePath = useQuotePath();

    const [quoteOut, setQuoteOut] = useState<string | null>(null);

    const findForm = useAppForm({
        defaultValues: {
            payee: "",
            fromAsset: undefined as number | undefined,
            toAsset: undefined as number | undefined,
            maxHops: "6",
            amount: "1.00",
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
            await new Promise<void>((resolve, reject) => {
                quotePath.mutate(
                    {
                        fromAccount: user,
                        toAccount: value.payee.trim(),
                        amount: value.amount.trim(),
                        fromAsset: value.fromAsset!,
                        toAsset: value.toAsset!,
                        maxHops: hopsN,
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
                            execForm.setFieldValue("amount", value.amount.trim());
                            execForm.setFieldValue("minReturn", q.minReturn);
                            setQuoteOut(q.amountOut);
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
            await new Promise<void>((resolve, reject) => {
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
    };

    const removeLastHop = () => {
        const hops = execForm.state.values.hops;
        if (hops.length <= 1) return;
        execForm.setFieldValue("hops", hops.slice(0, -1));
    };

    return (
        <div className="space-y-8">
            <PageHeader
                title="Path pay"
                description="Draw along a hop list. First hop uses a credit line only; later same-asset hops need routing (fixed + % fee). Asset changes auto-convert via the previous edge debtor's currency policy. Use Find path to discover a route from you to a payee (scoped graph search)."
            />

            <section className="grid max-w-2xl gap-4 rounded-lg border p-4">
                <h2 className="font-medium">Find path</h2>
                <p className="text-muted-foreground text-xs">
                    Off-chain quote using credit lines, routing, and FX policies
                    expanded from your account toward the payee (not a full
                    network dump). Fills the hop list below; you can still edit
                    hops before paying.
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
                                    label="Payee (final hop)"
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
                        selector={(s) => s.values.fromAsset}
                        children={(fromAsset) => (
                            <findForm.AppField
                                name="amount"
                                children={(field) => (
                                    <field.TextField
                                        label={
                                            fromAsset !== undefined
                                                ? `Amount (${amountPlaceholder(precisionOf(fromAsset))})`
                                                : "Amount"
                                        }
                                        inputMode="decimal"
                                    />
                                )}
                            />
                        )}
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
                        <execForm.Subscribe
                            selector={(s) =>
                                s.values.hops[s.values.hops.length - 1]
                                    ?.assetId
                            }
                            children={(lastAsset) =>
                                quoteOut ? (
                                    <p className="text-muted-foreground text-sm font-mono">
                                        Est. out: {quoteOut}
                                        {lastAsset !== undefined
                                            ? ` ${symbolOf(lastAsset)}`
                                            : ""}
                                    </p>
                                ) : null
                            }
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
                            {hops.map((hop, i) => (
                                <div
                                    key={i}
                                    className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
                                >
                                    <execForm.AppField
                                        name={`hops[${i}].account`}
                                        children={(field) => (
                                            <field.TextField
                                                label={`Hop ${i + 1} account`}
                                                placeholder={
                                                    i === 0 ? "gary" : "steve"
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
                                                    field.handleChange(id)
                                                }
                                            />
                                        )}
                                    />
                                </div>
                            ))}
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

                <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                    <execForm.Subscribe
                        selector={(s) => s.values.hops[0]?.assetId}
                        children={(firstAsset) => (
                            <execForm.AppField
                                name="amount"
                                children={(field) => (
                                    <field.TextField
                                        label={
                                            firstAsset !== undefined
                                                ? `Amount (${amountPlaceholder(precisionOf(firstAsset))})`
                                                : "Amount"
                                        }
                                        inputMode="decimal"
                                        required
                                    />
                                )}
                            />
                        )}
                    />
                    <execForm.Subscribe
                        selector={(s) =>
                            s.values.hops[s.values.hops.length - 1]?.assetId
                        }
                        children={(lastAsset) => (
                            <execForm.AppField
                                name="minReturn"
                                children={(field) => (
                                    <field.TextField
                                        label={
                                            lastAsset !== undefined
                                                ? `Min return (${amountPlaceholder(precisionOf(lastAsset))})`
                                                : "Min return (last asset)"
                                        }
                                        inputMode="decimal"
                                        required
                                    />
                                )}
                            />
                        )}
                    />
                </div>

                <execForm.AppForm>
                    <execForm.SubmitButton
                        labels={["Path pay", "Submitting…"]}
                        loading={pathPay.isPending}
                    />
                </execForm.AppForm>
            </form>
        </div>
    );
}

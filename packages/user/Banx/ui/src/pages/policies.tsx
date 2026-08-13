import { useState } from "react";

import { AssetField, ExpiresField } from "@/components/form-fields";
import {
    formatExpiresAt,
} from "@/components/expires-at-picker";
import { PageHeader } from "@/components/page-header";
import { RoutingPolicyDialog } from "@/components/routing-policy-dialog";
import { useAssetMap } from "@/hooks/use-assets";
import {
    useCurrencyPolicies,
    useRoutingPolicies,
} from "@/hooks/use-banx-data";
import {
    useConvert,
    useSetCurrencyPolicy,
} from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    formatFxToRate,
    formatRawAmount,
    formatToPrecision,
} from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";
import { percentStringToPpm, useAppForm } from "@/lib/form";

import { Button } from "@shared/shadcn/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

export function PoliciesPage() {
    const { assets, symbolOf, precisionOf } = useAssetMap();
    const { data: routing = [] } = useRoutingPolicies();
    const { data: currency = [] } = useCurrencyPolicies();
    const setCurrency = useSetCurrencyPolicy();
    const convert = useConvert();

    const globalRouting = routing.filter((p) => p.isGlobal);
    const specificRouting = routing.filter((p) => !p.isGlobal);

    const [routingDialogOpen, setRoutingDialogOpen] = useState(false);

    const currencyForm = useAppForm({
        defaultValues: {
            fromAsset: undefined as number | undefined,
            toAsset: undefined as number | undefined,
            feeFixed: "0",
            toRate: "1",
            aprPct: "0",
            expiresAtSeconds: 0,
        },
        onSubmit: async ({ value }) => {
            if (value.fromAsset === undefined || value.toAsset === undefined)
                return;
            await new Promise<void>((resolve, reject) => {
                setCurrency.mutate(
                    {
                        fromAsset: value.fromAsset!,
                        toAsset: value.toAsset!,
                        feeFixed: value.feeFixed.trim(),
                        toRate: value.toRate.trim(),
                        toInterestRatePpm: percentStringToPpm(value.aprPct),
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

    const convertForm = useAppForm({
        defaultValues: {
            counterparty: "",
            fromAsset: undefined as number | undefined,
            toAsset: undefined as number | undefined,
            amountFrom: "1.00",
            minTo: "0.01",
        },
        onSubmit: async ({ value }) => {
            if (
                value.fromAsset === undefined ||
                value.toAsset === undefined ||
                !value.counterparty.trim()
            )
                return;
            await new Promise<void>((resolve, reject) => {
                convert.mutate(
                    {
                        counterparty: value.counterparty.trim(),
                        fromAsset: value.fromAsset!,
                        toAsset: value.toAsset!,
                        amountFrom: value.amountFrom.trim(),
                        minTo: value.minTo.trim(),
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: (e: Error) => reject(e),
                    },
                );
            });
        },
    });

    return (
        <div className="space-y-10">
            <PageHeader
                title="Policies"
                description="Global routing applies to every credit line in an asset (stored as creditor = 0). Optional per-creditor overrides. Currency policies handle FX (enter how many to-units you get per 1 from-unit)."
            />

            <RoutingPolicyDialog
                open={routingDialogOpen}
                onOpenChange={setRoutingDialogOpen}
                assets={assets}
            />

            <section className="grid gap-8 lg:grid-cols-2">
                <div className="grid gap-3 rounded-lg border p-4">
                    <h2 className="font-medium">Set routing policy</h2>
                    <p className="text-muted-foreground text-xs">
                        Same-asset path hop fees. Leave next-hop blank for a{" "}
                        <strong>global</strong> policy, or set a per-creditor
                        override. Also available from Accounts via the route
                        icon.
                    </p>
                    <Button
                        type="button"
                        onClick={() => setRoutingDialogOpen(true)}
                    >
                        Open routing form
                    </Button>
                </div>

                <form
                    className="grid gap-3 rounded-lg border p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void currencyForm.handleSubmit();
                    }}
                >
                    <h2 className="font-medium">Set currency policy</h2>
                    <p className="text-muted-foreground text-xs">
                        You are the debtor posting a convert quote for all
                        holders of your from-asset obligations. Rate is to-units
                        per 1 from-unit (e.g. 0.45 means $1 → $0.45).
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <currencyForm.Field
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
                        <currencyForm.Field
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
                    <div className="grid gap-2 sm:grid-cols-2">
                        <currencyForm.Subscribe
                            selector={(s) => s.values}
                            children={(values) => (
                                <div className="grid gap-2">
                                    <currencyForm.AppField
                                        name="feeFixed"
                                        children={(field) => (
                                            <field.TextField
                                                label={
                                                    values.fromAsset !==
                                                    undefined
                                                        ? `Fee fixed (${symbolOf(values.fromAsset)})`
                                                        : "Fee fixed"
                                                }
                                                inputMode="decimal"
                                                placeholder={
                                                    values.fromAsset !==
                                                    undefined
                                                        ? amountPlaceholder(
                                                              precisionOf(
                                                                  values.fromAsset,
                                                              ),
                                                          )
                                                        : "0"
                                                }
                                            />
                                        )}
                                    />
                                    {values.fromAsset !== undefined ? (
                                        <p className="text-muted-foreground text-xs font-mono">
                                            {formatToPrecision(
                                                values.feeFixed,
                                                precisionOf(values.fromAsset),
                                            ) ?? "?"}{" "}
                                            {symbolOf(values.fromAsset)}
                                        </p>
                                    ) : null}
                                </div>
                            )}
                        />
                        <currencyForm.Subscribe
                            selector={(s) => s.values}
                            children={(values) => (
                                <div className="grid gap-2">
                                    <currencyForm.AppField
                                        name="toRate"
                                        children={(field) => (
                                            <field.TextField
                                                label="Rate (to per 1 from)"
                                                inputMode="decimal"
                                                placeholder="0.45"
                                            />
                                        )}
                                    />
                                    {values.fromAsset !== undefined &&
                                    values.toAsset !== undefined ? (
                                        <p className="text-muted-foreground text-xs font-mono">
                                            1 {symbolOf(values.fromAsset)} →{" "}
                                            {formatToPrecision(
                                                values.toRate,
                                                precisionOf(values.toAsset),
                                            ) ??
                                                (values.toRate || "?")}{" "}
                                            {symbolOf(values.toAsset)}
                                        </p>
                                    ) : null}
                                </div>
                            )}
                        />
                    </div>
                    <currencyForm.AppField
                        name="aprPct"
                        children={(field) => (
                            <field.TextField
                                label="To-asset APR %"
                                inputMode="decimal"
                            />
                        )}
                    />
                    <currencyForm.Field
                        name="expiresAtSeconds"
                        children={(field) => (
                            <ExpiresField
                                value={field.state.value}
                                onChange={(v) => field.handleChange(v)}
                            />
                        )}
                    />
                    <currencyForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) => (
                            <currencyForm.AppForm>
                                <currencyForm.SubmitButton
                                    labels={[
                                        "Save currency policy",
                                        "Saving…",
                                    ]}
                                    loading={setCurrency.isPending}
                                    disabled={
                                        values.fromAsset === undefined ||
                                        values.toAsset === undefined
                                    }
                                />
                            </currencyForm.AppForm>
                        )}
                    />
                </form>
            </section>

            <section className="grid max-w-xl gap-3 rounded-lg border p-4">
                <h2 className="font-medium">Convert debt</h2>
                <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void convertForm.handleSubmit();
                    }}
                >
                    <convertForm.AppField
                        name="counterparty"
                        children={(field) => (
                            <field.TextField label="Counterparty" required />
                        )}
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                        <convertForm.Field
                            name="fromAsset"
                            children={(field) => (
                                <AssetField
                                    label="From"
                                    assets={assets}
                                    value={field.state.value}
                                    onChange={(id) => field.handleChange(id)}
                                />
                            )}
                        />
                        <convertForm.Field
                            name="toAsset"
                            children={(field) => (
                                <AssetField
                                    label="To"
                                    assets={assets}
                                    value={field.state.value}
                                    onChange={(id) => field.handleChange(id)}
                                />
                            )}
                        />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <convertForm.AppField
                            name="amountFrom"
                            children={(field) => (
                                <field.TextField
                                    label="Amount from (decimal)"
                                    inputMode="decimal"
                                />
                            )}
                        />
                        <convertForm.AppField
                            name="minTo"
                            children={(field) => (
                                <field.TextField
                                    label="Min to (decimal)"
                                    inputMode="decimal"
                                />
                            )}
                        />
                    </div>
                    <convertForm.Subscribe
                        selector={(s) => s.values}
                        children={(values) => (
                            <convertForm.AppForm>
                                <convertForm.SubmitButton
                                    labels={["Convert", "Converting…"]}
                                    loading={convert.isPending}
                                    disabled={
                                        values.fromAsset === undefined ||
                                        values.toAsset === undefined
                                    }
                                />
                            </convertForm.AppForm>
                        )}
                    />
                </form>
            </section>

            <section className="space-y-4">
                <h2 className="font-medium">Your routing policies</h2>
                {routing.length === 0 ? (
                    <p className="text-muted-foreground text-sm">None</p>
                ) : (
                    <div className="overflow-x-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Scope</TableHead>
                                    <TableHead>Asset</TableHead>
                                    <TableHead className="text-right">
                                        Fixed fee
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Fee %
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Max APR
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Expires
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {[...globalRouting, ...specificRouting].map(
                                    (p) => (
                                        <TableRow
                                            key={`${p.isGlobal ? "g" : p.creditor}-${p.assetId}`}
                                        >
                                            <TableCell>
                                                {p.isGlobal
                                                    ? "Global (any line)"
                                                    : p.creditor}
                                            </TableCell>
                                            <TableCell>
                                                {symbolOf(p.assetId)}
                                            </TableCell>
                                            <TableCell className="text-right font-mono">
                                                {formatRawAmount(
                                                    p.hopFeeFixed,
                                                    precisionOf(p.assetId),
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {ppmToPercent(
                                                    p.hopFeePercentPpm,
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {ppmToPercent(
                                                    p.maxAcceptRatePpm,
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right text-sm">
                                                {formatExpiresAt(p.expiresAt)}
                                            </TableCell>
                                        </TableRow>
                                    ),
                                )}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </section>

            <section>
                <h2 className="mb-2 font-medium">Your currency policies</h2>
                {currency.length === 0 ? (
                    <p className="text-muted-foreground text-sm">None</p>
                ) : (
                    <div className="overflow-x-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>From → To</TableHead>
                                    <TableHead className="text-right">
                                        Fee
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Rate (to per 1 from)
                                    </TableHead>
                                    <TableHead className="text-right">
                                        To APR
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Expires
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {currency.map((p) => (
                                    <TableRow
                                        key={`${p.fromAsset}-${p.toAsset}`}
                                    >
                                        <TableCell>
                                            {symbolOf(p.fromAsset)} →{" "}
                                            {symbolOf(p.toAsset)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {formatRawAmount(
                                                p.feeFixed,
                                                precisionOf(p.fromAsset),
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            1 →{" "}
                                            {formatFxToRate(
                                                p.fxRate,
                                                precisionOf(p.fromAsset),
                                                precisionOf(p.toAsset),
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {ppmToPercent(p.toInterestRatePpm)}
                                        </TableCell>
                                        <TableCell className="text-right text-sm">
                                            {formatExpiresAt(p.expiresAt)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </section>
        </div>
    );
}

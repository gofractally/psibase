import { AssetField, ExpiresField } from "@/components/form-fields";
import { formatExpiresAt } from "@/components/expires-at-picker";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import {
    useCurrencyPolicies,
    useForwardOffers,
    useBuyClaimOffers,
} from "@/hooks/use-banx-data";
import { useConvert, useSetCurrencyPolicy } from "@/hooks/use-banx-mutations";
import {
    amountPlaceholder,
    displayAmount,
    formatFxToRate,
    formatToPrecision,
} from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";
import {
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    percentFieldValidator,
    percentStringToPpm,
    useAppForm,
} from "@/lib/form";

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
    const { data: forwardOffers = [] } = useForwardOffers();
    const { data: buyClaimOffers = [] } = useBuyClaimOffers();
    const { data: currency = [] } = useCurrencyPolicies();
    const setCurrency = useSetCurrencyPolicy();
    const convert = useConvert();

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
                        toInterestRatePpm: percentStringToPpm(
                            value.aprPct,
                            PPM_SCALE,
                        ),
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
                description="Currency policies handle FX (how many to-units you get per 1 from-unit). Path-forward and buy-claim offers are posted from Accounts."
            />

            <section className="grid gap-8 lg:grid-cols-2">
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
                        You set the rate for hops that change currency through
                        you, and for converting claims you hold. Rate is
                        to-units per 1 from-unit (e.g. 0.45 means $1 → $0.45).
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
                        validators={{
                            onChange: percentFieldValidator(MAX_PERCENT),
                            onSubmit: percentFieldValidator(MAX_PERCENT),
                        }}
                        children={(field) => (
                            <field.TextField
                                label="To-asset APR %"
                                inputMode="decimal"
                                min={0}
                                max={MAX_PERCENT}
                                step={MIN_PERCENT_STEP}
                                description="0–100% (0.0001% = 1 ppm)"
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
                <h2 className="font-medium">Path-forward offers</h2>
                {forwardOffers.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        None — post from Accounts (route icon). Lets others hop
                        through you on a path pay.
                    </p>
                ) : (
                    <div className="overflow-x-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Next hop</TableHead>
                                    <TableHead>Asset</TableHead>
                                    <TableHead className="text-right">
                                        Fixed fee
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Fee %
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Max line APR
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Expires
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {forwardOffers.map((p) => (
                                    <TableRow
                                        key={`${p.isGlobal ? "g" : p.nextHop}-${p.assetId}`}
                                    >
                                        <TableCell>
                                            {p.isGlobal ? "Global" : p.nextHop}
                                        </TableCell>
                                        <TableCell>
                                            {symbolOf(p.assetId)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {displayAmount(p.feeFixed)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {ppmToPercent(p.feePercentPpm)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {ppmToPercent(p.maxLineAprPpm)}
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

            <section className="space-y-4">
                <h2 className="font-medium">Buy-claim offers</h2>
                {buyClaimOffers.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        None — post from Accounts (handshake icon). Lets others
                        sell you claims on debtors you have lined.
                    </p>
                ) : (
                    <div className="overflow-x-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Debtor</TableHead>
                                    <TableHead>Asset</TableHead>
                                    <TableHead className="text-right">
                                        Fixed fee
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Fee %
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Expires
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {buyClaimOffers.map((p) => (
                                    <TableRow
                                        key={`${p.isGlobal ? "g" : p.debtor}-${p.assetId}`}
                                    >
                                        <TableCell>
                                            {p.isGlobal ? "Global" : p.debtor}
                                        </TableCell>
                                        <TableCell>
                                            {symbolOf(p.assetId)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {displayAmount(p.feeFixed)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {ppmToPercent(p.feePercentPpm)}
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
                                            {displayAmount(p.feeFixed)}
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

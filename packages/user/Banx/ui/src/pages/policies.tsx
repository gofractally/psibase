import { useState } from "react";

import { AssetSelect } from "@/components/asset-select";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import {
    useCurrencyPolicies,
    useRoutingPolicies,
} from "@/hooks/use-banx-data";
import {
    useConvert,
    useSetCurrencyPolicy,
    useSetGlobalRoutingPolicy,
    useSetRoutingPolicy,
} from "@/hooks/use-banx-mutations";
import { formatFxToRate, formatRawAmount } from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
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
    const setGlobalRouting = useSetGlobalRoutingPolicy();
    const setRouting = useSetRoutingPolicy();
    const setCurrency = useSetCurrencyPolicy();
    const convert = useConvert();

    const globalRouting = routing.filter((p) => p.isGlobal);
    const specificRouting = routing.filter((p) => !p.isGlobal);

    // Global routing form (same-asset, any next hop)
    const [rAsset, setRAsset] = useState<number | undefined>();
    const [rFee, setRFee] = useState("0");
    const [rFeePct, setRFeePct] = useState("0");
    const [rMaxPct, setRMaxPct] = useState("100");
    const [rExp, setRExp] = useState("0");

    // Optional per-creditor override
    const [rCreditor, setRCreditor] = useState("");

    // Currency form
    const [cFrom, setCFrom] = useState<number | undefined>();
    const [cTo, setCTo] = useState<number | undefined>();
    const [cFee, setCFee] = useState("0");
    /** To-asset units per 1 from-asset unit (e.g. 0.45 → $1 → $0.45). */
    const [cToRate, setCToRate] = useState("1");
    const [cApr, setCApr] = useState("0");
    const [cExp, setCExp] = useState("0");

    // Convert form
    const [cvCp, setCvCp] = useState("");
    const [cvFrom, setCvFrom] = useState<number | undefined>();
    const [cvTo, setCvTo] = useState<number | undefined>();
    const [cvAmt, setCvAmt] = useState("1.00");
    const [cvMin, setCvMin] = useState("0.01");

    return (
        <div className="space-y-10">
            <PageHeader
                title="Policies"
                description="Global routing applies to every credit line in an asset (stored as creditor = 0). Optional per-creditor overrides. Currency policies handle FX (enter how many to-units you get per 1 from-unit)."
            />

            <section className="grid gap-8 lg:grid-cols-2">
                <form
                    className="grid gap-3 rounded-lg border p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (rAsset === undefined) return;
                        const fees = {
                            assetId: rAsset,
                            hopFeeFixed: rFee.trim(),
                            hopFeePercentPpm: Math.round(
                                Number(rFeePct) * 10_000,
                            ),
                            maxAcceptRatePpm: Math.round(
                                Number(rMaxPct) * 10_000,
                            ),
                            expiresAtSeconds: Number(rExp),
                        };
                        if (rCreditor.trim()) {
                            setRouting.mutate({
                                creditor: rCreditor.trim(),
                                ...fees,
                            });
                        } else {
                            setGlobalRouting.mutate(fees);
                        }
                    }}
                >
                    <h2 className="font-medium">Set routing policy</h2>
                    <p className="text-muted-foreground text-xs">
                        Leave next-hop blank for a <strong>global</strong>{" "}
                        policy (all lines in this asset). Fill next-hop for a
                        per-creditor override. Same asset only — no FX here.
                    </p>
                    <div className="grid gap-2">
                        <Label>Next-hop creditor (optional)</Label>
                        <Input
                            value={rCreditor}
                            onChange={(e) => setRCreditor(e.target.value)}
                            placeholder="empty = global"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Asset</Label>
                        <AssetSelect
                            assets={assets}
                            value={rAsset}
                            onChange={setRAsset}
                        />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>Hop fee fixed (decimal)</Label>
                            <Input
                                inputMode="decimal"
                                value={rFee}
                                onChange={(e) => setRFee(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Hop fee %</Label>
                            <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={rFeePct}
                                onChange={(e) => setRFeePct(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>Max accept APR %</Label>
                            <Input
                                type="number"
                                min={0}
                                value={rMaxPct}
                                onChange={(e) => setRMaxPct(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Expires at (unix sec, 0=never)</Label>
                            <Input
                                type="number"
                                min={0}
                                value={rExp}
                                onChange={(e) => setRExp(e.target.value)}
                            />
                        </div>
                    </div>
                    <Button
                        type="submit"
                        disabled={
                            setGlobalRouting.isPending || setRouting.isPending
                        }
                    >
                        {rCreditor.trim()
                            ? "Save override"
                            : "Save global routing"}
                    </Button>
                </form>

                <form
                    className="grid gap-3 rounded-lg border p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (cFrom === undefined || cTo === undefined) return;
                        setCurrency.mutate({
                            fromAsset: cFrom,
                            toAsset: cTo,
                            feeFixed: cFee.trim(),
                            toRate: cToRate.trim(),
                            toInterestRatePpm: Math.round(
                                Number(cApr) * 10_000,
                            ),
                            expiresAtSeconds: Number(cExp),
                        });
                    }}
                >
                    <h2 className="font-medium">Set currency policy</h2>
                    <p className="text-muted-foreground text-xs">
                        You are the debtor posting a convert quote for all
                        holders of your from-asset obligations. Rate is to-units
                        per 1 from-unit (e.g. 0.45 means $1 → $0.45).
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>From asset</Label>
                            <AssetSelect
                                assets={assets}
                                value={cFrom}
                                onChange={setCFrom}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>To asset</Label>
                            <AssetSelect
                                assets={assets}
                                value={cTo}
                                onChange={setCTo}
                            />
                        </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>Fee fixed (from-asset decimal)</Label>
                            <Input
                                inputMode="decimal"
                                value={cFee}
                                onChange={(e) => setCFee(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Rate (to per 1 from)</Label>
                            <Input
                                inputMode="decimal"
                                value={cToRate}
                                onChange={(e) => setCToRate(e.target.value)}
                                placeholder="0.45"
                            />
                            {cFrom !== undefined && cTo !== undefined && (
                                <p className="text-muted-foreground text-xs font-mono">
                                    1 {symbolOf(cFrom)} → {cToRate || "?"}{" "}
                                    {symbolOf(cTo)}
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>To-asset APR %</Label>
                            <Input
                                type="number"
                                min={0}
                                value={cApr}
                                onChange={(e) => setCApr(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Expires at (unix sec, 0=never)</Label>
                            <Input
                                type="number"
                                min={0}
                                value={cExp}
                                onChange={(e) => setCExp(e.target.value)}
                            />
                        </div>
                    </div>
                    <Button type="submit" disabled={setCurrency.isPending}>
                        Save currency policy
                    </Button>
                </form>
            </section>

            <section className="grid gap-3 rounded-lg border p-4 max-w-xl">
                <h2 className="font-medium">Convert debt</h2>
                <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (cvFrom === undefined || cvTo === undefined || !cvCp)
                            return;
                        convert.mutate({
                            counterparty: cvCp.trim(),
                            fromAsset: cvFrom,
                            toAsset: cvTo,
                            amountFrom: cvAmt.trim(),
                            minTo: cvMin.trim(),
                        });
                    }}
                >
                    <div className="grid gap-2">
                        <Label>Counterparty</Label>
                        <Input
                            value={cvCp}
                            onChange={(e) => setCvCp(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>From</Label>
                            <AssetSelect
                                assets={assets}
                                value={cvFrom}
                                onChange={setCvFrom}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>To</Label>
                            <AssetSelect
                                assets={assets}
                                value={cvTo}
                                onChange={setCvTo}
                            />
                        </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>Amount from (decimal)</Label>
                            <Input
                                inputMode="decimal"
                                value={cvAmt}
                                onChange={(e) => setCvAmt(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Min to (decimal)</Label>
                            <Input
                                inputMode="decimal"
                                value={cvMin}
                                onChange={(e) => setCvMin(e.target.value)}
                            />
                        </div>
                    </div>
                    <Button type="submit" disabled={convert.isPending}>
                        Convert
                    </Button>
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

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
    useSetRoutingPolicy,
} from "@/hooks/use-banx-mutations";
import { formatRawAmount } from "@/lib/amount";
import { ppmToPercent, RATE_SCALE } from "@/lib/constants";

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
    const setRouting = useSetRoutingPolicy();
    const setCurrency = useSetCurrencyPolicy();
    const convert = useConvert();

    // Routing form
    const [rCreditor, setRCreditor] = useState("");
    const [rIn, setRIn] = useState<number | undefined>();
    const [rOut, setROut] = useState<number | undefined>();
    const [rFee, setRFee] = useState("0");
    const [rMaxPct, setRMaxPct] = useState("100");
    const [rFx, setRFx] = useState(String(RATE_SCALE));
    const [rExp, setRExp] = useState("0");

    // Currency form
    const [cFrom, setCFrom] = useState<number | undefined>();
    const [cTo, setCTo] = useState<number | undefined>();
    const [cFee, setCFee] = useState("0");
    const [cFx, setCFx] = useState(String(RATE_SCALE));
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
                description="Routing policies enable multi-hop path pay. Currency policies let debtors re-denominate claims (FX). Prefer short expiry for FX quotes. fx_rate uses RATE_SCALE (1e6 = 1:1)."
            />

            <section className="grid gap-8 lg:grid-cols-2">
                <form
                    className="grid gap-3 rounded-lg border p-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (rIn === undefined || rOut === undefined || !rCreditor)
                            return;
                        setRouting.mutate({
                            creditor: rCreditor.trim(),
                            inAsset: rIn,
                            outAsset: rOut,
                            hopFeeFixed: rFee.trim(),
                            maxAcceptRatePpm: Math.round(
                                Number(rMaxPct) * 10_000,
                            ),
                            fxRate: Number(rFx),
                            expiresAtSeconds: Number(rExp),
                        });
                    }}
                >
                    <h2 className="font-medium">Set routing policy</h2>
                    <p className="text-muted-foreground text-xs">
                        You are the intermediate (debtor). Creditor is the next
                        hop you may path-draw on.
                    </p>
                    <div className="grid gap-2">
                        <Label>Next-hop creditor</Label>
                        <Input
                            value={rCreditor}
                            onChange={(e) => setRCreditor(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>In asset</Label>
                            <AssetSelect
                                assets={assets}
                                value={rIn}
                                onChange={setRIn}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Out asset</Label>
                            <AssetSelect
                                assets={assets}
                                value={rOut}
                                onChange={setROut}
                            />
                        </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>Hop fee (in-asset decimal)</Label>
                            <Input
                                inputMode="decimal"
                                value={rFee}
                                onChange={(e) => setRFee(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label>Max accept APR %</Label>
                            <Input
                                type="number"
                                min={0}
                                value={rMaxPct}
                                onChange={(e) => setRMaxPct(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>FX / take rate (scale {RATE_SCALE})</Label>
                            <Input
                                type="number"
                                min={1}
                                value={rFx}
                                onChange={(e) => setRFx(e.target.value)}
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
                    <Button type="submit" disabled={setRouting.isPending}>
                        Save routing policy
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
                            fxRate: Number(cFx),
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
                        holders of your from-asset obligations.
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
                            <Label>FX rate (scale {RATE_SCALE})</Label>
                            <Input
                                type="number"
                                min={1}
                                value={cFx}
                                onChange={(e) => setCFx(e.target.value)}
                            />
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

            <section>
                <h2 className="mb-2 font-medium">Your routing policies</h2>
                {routing.length === 0 ? (
                    <p className="text-muted-foreground text-sm">None</p>
                ) : (
                    <div className="overflow-x-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Creditor</TableHead>
                                    <TableHead>In → Out</TableHead>
                                    <TableHead className="text-right">
                                        Fee
                                    </TableHead>
                                    <TableHead className="text-right">
                                        FX
                                    </TableHead>
                                    <TableHead className="text-right">
                                        Max APR
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {routing.map((p) => (
                                    <TableRow
                                        key={`${p.creditor}-${p.inAsset}-${p.outAsset}`}
                                    >
                                        <TableCell>{p.creditor}</TableCell>
                                        <TableCell>
                                            {symbolOf(p.inAsset)} →{" "}
                                            {symbolOf(p.outAsset)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {formatRawAmount(
                                                p.hopFeeFixed,
                                                precisionOf(p.inAsset),
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {p.fxRate}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {ppmToPercent(p.maxAcceptRatePpm)}
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
                                        FX
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
                                            {p.fxRate}
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

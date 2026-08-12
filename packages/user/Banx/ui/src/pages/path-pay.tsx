import { useState } from "react";

import {
    AssetSelect,
    defaultAssetId,
} from "@/components/asset-select";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import { usePathPay, useQuotePath } from "@/hooks/use-banx-mutations";
import { amountPlaceholder } from "@/lib/amount";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

type Hop = { account: string; assetId: number | undefined };

export function PathPayPage() {
    const { data: user } = useCurrentUser();
    const { assets, precisionOf, symbolOf } = useAssetMap();
    const pathPay = usePathPay();
    const quotePath = useQuotePath();

    const [payee, setPayee] = useState("");
    const [fromAsset, setFromAsset] = useState<number | undefined>();
    const [toAsset, setToAsset] = useState<number | undefined>();
    const [maxHops, setMaxHops] = useState("6");
    const [hops, setHops] = useState<Hop[]>([
        { account: "", assetId: undefined },
    ]);
    const [amount, setAmount] = useState("1.00");
    const [minReturn, setMinReturn] = useState("0.01");
    const [quoteOut, setQuoteOut] = useState<string | null>(null);

    const updateHop = (i: number, patch: Partial<Hop>) => {
        setHops((prev) =>
            prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)),
        );
    };

    const addHop = () => {
        setHops((h) => {
            const prevAsset = h[h.length - 1]?.assetId;
            return [
                ...h,
                {
                    account: "",
                    assetId: prevAsset ?? defaultAssetId(assets),
                },
            ];
        });
    };

    const onFindPath = () => {
        if (
            !user ||
            !payee.trim() ||
            fromAsset === undefined ||
            toAsset === undefined
        )
            return;
        const hopsN = Math.min(12, Math.max(1, Number(maxHops) || 6));
        quotePath.mutate(
            {
                fromAccount: user,
                toAccount: payee.trim(),
                amount: amount.trim(),
                fromAsset,
                toAsset,
                maxHops: hopsN,
            },
            {
                onSuccess: (q) => {
                    setHops(
                        q.hops.map((h) => ({
                            account: h.account,
                            assetId: h.assetId,
                        })),
                    );
                    setMinReturn(q.minReturn);
                    setQuoteOut(q.amountOut);
                },
            },
        );
    };

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const cleaned = hops
            .filter((h) => h.account.trim() && h.assetId !== undefined)
            .map((h) => ({ account: h.account.trim(), assetId: h.assetId! }));
        if (cleaned.length === 0) return;
        pathPay.mutate({
            hops: cleaned,
            amount: amount.trim(),
            minReturn: minReturn.trim(),
        });
    };

    const firstAsset = hops[0]?.assetId ?? fromAsset;
    const lastAsset = hops[hops.length - 1]?.assetId;

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
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                        <Label htmlFor="payee">Payee (final hop)</Label>
                        <Input
                            id="payee"
                            value={payee}
                            onChange={(e) => setPayee(e.target.value)}
                            placeholder="brandon"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Max hops</Label>
                        <Input
                            type="number"
                            min={1}
                            max={12}
                            value={maxHops}
                            onChange={(e) => setMaxHops(e.target.value)}
                        />
                    </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                        <Label>From asset</Label>
                        <AssetSelect
                            assets={assets}
                            value={fromAsset}
                            onChange={setFromAsset}
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>To asset</Label>
                        <AssetSelect
                            assets={assets}
                            value={toAsset}
                            onChange={setToAsset}
                        />
                    </div>
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="find-amount">
                        Amount
                        {fromAsset !== undefined
                            ? ` (${amountPlaceholder(precisionOf(fromAsset))})`
                            : ""}
                    </Label>
                    <Input
                        id="find-amount"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={
                            quotePath.isPending ||
                            !user ||
                            !payee.trim() ||
                            fromAsset === undefined ||
                            toAsset === undefined
                        }
                        onClick={onFindPath}
                    >
                        {quotePath.isPending ? "Searching…" : "Find path"}
                    </Button>
                    {quoteOut ? (
                        <p className="text-muted-foreground text-sm font-mono">
                            Est. out: {quoteOut}
                            {lastAsset !== undefined
                                ? ` ${symbolOf(lastAsset)}`
                                : ""}
                        </p>
                    ) : null}
                </div>
            </section>

            <form
                onSubmit={onSubmit}
                className="grid max-w-2xl gap-4 rounded-lg border p-4"
            >
                <h2 className="font-medium">Hops &amp; execute</h2>
                <div className="space-y-4">
                    {hops.map((hop, i) => (
                        <div
                            key={i}
                            className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
                        >
                            <div className="grid gap-2">
                                <Label>Hop {i + 1} account</Label>
                                <Input
                                    value={hop.account}
                                    onChange={(e) =>
                                        updateHop(i, {
                                            account: e.target.value,
                                        })
                                    }
                                    placeholder={i === 0 ? "gary" : "steve"}
                                    required
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label>Asset</Label>
                                <AssetSelect
                                    assets={assets}
                                    value={hop.assetId}
                                    onChange={(id) =>
                                        updateHop(i, { assetId: id })
                                    }
                                />
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={addHop}>
                        Add hop
                    </Button>
                    {hops.length > 1 ? (
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setHops((h) => h.slice(0, -1))}
                        >
                            Remove last hop
                        </Button>
                    ) : null}
                </div>

                <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="amount">
                            Amount
                            {firstAsset !== undefined
                                ? ` (${amountPlaceholder(precisionOf(firstAsset))})`
                                : ""}
                        </Label>
                        <Input
                            id="amount"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="min">
                            Min return (last asset)
                            {lastAsset !== undefined
                                ? ` (${amountPlaceholder(precisionOf(lastAsset))})`
                                : ""}
                        </Label>
                        <Input
                            id="min"
                            inputMode="decimal"
                            value={minReturn}
                            onChange={(e) => setMinReturn(e.target.value)}
                            required
                        />
                    </div>
                </div>

                <Button type="submit" disabled={pathPay.isPending}>
                    {pathPay.isPending ? "Submitting…" : "Path pay"}
                </Button>
            </form>
        </div>
    );
}

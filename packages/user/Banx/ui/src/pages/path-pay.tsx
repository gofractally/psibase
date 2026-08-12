import { useState } from "react";

import { AssetSelect } from "@/components/asset-select";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import { usePathPay } from "@/hooks/use-banx-mutations";
import { amountPlaceholder } from "@/lib/amount";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

type Hop = { account: string; assetId: number | undefined };

export function PathPayPage() {
    const { assets, precisionOf } = useAssetMap();
    const pathPay = usePathPay();

    const [hops, setHops] = useState<Hop[]>([
        { account: "", assetId: undefined },
    ]);
    const [amount, setAmount] = useState("1.00");
    const [minReturn, setMinReturn] = useState("0.01");

    const updateHop = (i: number, patch: Partial<Hop>) => {
        setHops((prev) =>
            prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)),
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

    const firstAsset = hops[0]?.assetId;
    const lastAsset = hops[hops.length - 1]?.assetId;

    return (
        <div>
            <PageHeader
                title="Path pay"
                description="Draw along a hop list. First hop uses a credit line only; later hops need the intermediate's routing policy. Amounts are human decimals for the first/last hop assets."
            />

            <form
                onSubmit={onSubmit}
                className="grid max-w-2xl gap-4 rounded-lg border p-4"
            >
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
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                            setHops((h) => [
                                ...h,
                                { account: "", assetId: undefined },
                            ])
                        }
                    >
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

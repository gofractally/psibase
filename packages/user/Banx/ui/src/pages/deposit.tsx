import { useState } from "react";

import { AssetSelect } from "@/components/asset-select";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import { useDeposit } from "@/hooks/use-banx-mutations";
import { amountPlaceholder } from "@/lib/amount";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

export function DepositPage() {
    const { data: user } = useCurrentUser();
    const { assets, precisionOf } = useAssetMap();
    const deposit = useDeposit();

    const [depositor, setDepositor] = useState("");
    const [assetId, setAssetId] = useState<number | undefined>();
    const [amount, setAmount] = useState("1.00");
    const [interestPct, setInterestPct] = useState("0");

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!assetId || !depositor.trim()) return;
        deposit.mutate({
            depositor: depositor.trim(),
            assetId,
            amount: amount.trim(),
            interestRatePpm: Math.round(Number(interestPct) * 10_000),
        });
    };

    return (
        <div>
            <PageHeader
                title="Deposit"
                description={`You (${user}) are the receiver: book a liability to the depositor, then auto-net mutual claims. Cash never becomes a Banx balance.`}
            />

            <form
                onSubmit={onSubmit}
                className="grid max-w-xl gap-4 rounded-lg border p-4"
            >
                <div className="grid gap-2">
                    <Label htmlFor="depositor">Depositor account</Label>
                    <Input
                        id="depositor"
                        value={depositor}
                        onChange={(e) => setDepositor(e.target.value)}
                        placeholder="alice"
                        required
                    />
                </div>
                <div className="grid gap-2">
                    <Label>Asset</Label>
                    <AssetSelect
                        assets={assets}
                        value={assetId}
                        onChange={setAssetId}
                    />
                </div>
                <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="amount">
                            Amount{" "}
                            {assetId !== undefined
                                ? `(e.g. ${amountPlaceholder(precisionOf(assetId))})`
                                : ""}
                        </Label>
                        <Input
                            id="amount"
                            inputMode="decimal"
                            placeholder={
                                assetId !== undefined
                                    ? amountPlaceholder(precisionOf(assetId))
                                    : "0.00"
                            }
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="apr">Interest APR % on new claim</Label>
                        <Input
                            id="apr"
                            type="number"
                            step="0.01"
                            min={0}
                            value={interestPct}
                            onChange={(e) => setInterestPct(e.target.value)}
                        />
                    </div>
                </div>
                <Button type="submit" disabled={deposit.isPending || !assetId}>
                    {deposit.isPending ? "Booking…" : "Book deposit"}
                </Button>
            </form>
        </div>
    );
}

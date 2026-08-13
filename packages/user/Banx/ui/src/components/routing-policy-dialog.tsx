import { useEffect, useState } from "react";

import { AssetSelect } from "@/components/asset-select";
import { ExpiresAtPicker } from "@/components/expires-at-picker";
import {
    useSetGlobalRoutingPolicy,
    useSetRoutingPolicy,
} from "@/hooks/use-banx-mutations";
import type { Asset } from "@/lib/graphql";

import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";

export type RoutingPolicyPrefill = {
    /** Next-hop creditor; empty = global policy. */
    creditor?: string;
    assetId?: number;
};

/**
 * Post global or per-creditor same-asset routing (path hop fees).
 * Used from Policies and Accounts (settings cog).
 */
export function RoutingPolicyDialog({
    open,
    onOpenChange,
    assets,
    prefill,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assets: Asset[];
    prefill?: RoutingPolicyPrefill | null;
}) {
    const setGlobalRouting = useSetGlobalRoutingPolicy();
    const setRouting = useSetRoutingPolicy();

    const [creditor, setCreditor] = useState("");
    const [assetId, setAssetId] = useState<number | undefined>();
    const [fee, setFee] = useState("0");
    const [feePct, setFeePct] = useState("0");
    const [maxPct, setMaxPct] = useState("100");
    const [exp, setExp] = useState(0);

    useEffect(() => {
        if (!open) return;
        setCreditor(prefill?.creditor?.trim() ?? "");
        setAssetId(prefill?.assetId);
        setFee("0");
        setFeePct("0");
        setMaxPct("100");
        setExp(0);
    }, [open, prefill?.creditor, prefill?.assetId]);

    const pending = setGlobalRouting.isPending || setRouting.isPending;
    const isOverride = !!creditor.trim();

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (assetId === undefined) return;
        const fees = {
            assetId,
            hopFeeFixed: fee.trim(),
            hopFeePercentPpm: Math.round(Number(feePct) * 10_000),
            maxAcceptRatePpm: Math.round(Number(maxPct) * 10_000),
            expiresAtSeconds: exp,
        };
        const opts = {
            onSuccess: () => onOpenChange(false),
        };
        if (isOverride) {
            setRouting.mutate({ creditor: creditor.trim(), ...fees }, opts);
        } else {
            setGlobalRouting.mutate(fees, opts);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Set routing policy</DialogTitle>
                    <DialogDescription>
                        Same-asset path hop fees. Leave next-hop blank for a{" "}
                        <strong>global</strong> policy (all lines in this
                        asset). Fill next-hop for a per-creditor override.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={onSubmit} className="grid gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="rte-creditor">
                            Next-hop creditor (optional)
                        </Label>
                        <Input
                            id="rte-creditor"
                            value={creditor}
                            onChange={(e) => setCreditor(e.target.value)}
                            placeholder="empty = global"
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
                    <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
                        <div className="grid gap-2">
                            <Label htmlFor="rte-fee">Hop fee fixed</Label>
                            <Input
                                id="rte-fee"
                                inputMode="decimal"
                                value={fee}
                                onChange={(e) => setFee(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="rte-fee-pct">Hop fee %</Label>
                            <Input
                                id="rte-fee-pct"
                                type="number"
                                min={0}
                                step="0.01"
                                value={feePct}
                                onChange={(e) => setFeePct(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="rte-max">Max accept APR %</Label>
                        <Input
                            id="rte-max"
                            type="number"
                            min={0}
                            value={maxPct}
                            onChange={(e) => setMaxPct(e.target.value)}
                        />
                    </div>
                    <ExpiresAtPicker value={exp} onChange={setExp} />
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={pending || assetId === undefined}>
                            {pending
                                ? "Saving…"
                                : isOverride
                                  ? "Save override"
                                  : "Save global routing"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

import { useState } from "react";

import { AssetSelect } from "@/components/asset-select";
import { PageHeader } from "@/components/page-header";
import { useAssetMap } from "@/hooks/use-assets";
import { useCreditLines } from "@/hooks/use-banx-data";
import { useSetCreditLine } from "@/hooks/use-banx-mutations";
import { amountPlaceholder, formatRawAmount } from "@/lib/amount";
import { ppmToPercent } from "@/lib/constants";

import { useCurrentUser } from "@shared/hooks/use-current-user";
import { Button } from "@shared/shadcn/ui/button";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
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

export function CreditLinesPage() {
    const { data: user } = useCurrentUser();
    const { data: lines = [], isLoading } = useCreditLines();
    const { assets, symbolOf, precisionOf } = useAssetMap();
    const setLine = useSetCreditLine();

    const [debtor, setDebtor] = useState("");
    const [assetId, setAssetId] = useState<number | undefined>();
    const [limit, setLimit] = useState("100");
    const [interestPct, setInterestPct] = useState("0");
    const [deplete, setDeplete] = useState(false);

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!assetId || !debtor.trim()) return;
        setLine.mutate({
            debtor: debtor.trim(),
            assetId,
            limit: limit.trim(),
            depleteOnDebit: deplete,
            interestRatePpm: Math.round(Number(interestPct) * 10_000),
        });
    };

    return (
        <div>
            <PageHeader
                title="Credit lines"
                description="As creditor, set revolving exposure caps for debtors. Limit is max principal + interest outstanding, not a deposit."
            />

            <form
                onSubmit={onSubmit}
                className="mb-8 grid max-w-xl gap-4 rounded-lg border p-4"
            >
                <h2 className="font-medium">Offer a line</h2>
                <div className="grid gap-2">
                    <Label htmlFor="debtor">Debtor account</Label>
                    <Input
                        id="debtor"
                        value={debtor}
                        onChange={(e) => setDebtor(e.target.value)}
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
                        <Label htmlFor="limit">
                            Limit{" "}
                            {assetId !== undefined
                                ? `(e.g. ${amountPlaceholder(precisionOf(assetId))})`
                                : ""}
                        </Label>
                        <Input
                            id="limit"
                            inputMode="decimal"
                            placeholder={
                                assetId !== undefined
                                    ? amountPlaceholder(precisionOf(assetId))
                                    : "0.00"
                            }
                            value={limit}
                            onChange={(e) => setLimit(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="apr">Interest APR %</Label>
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
                <div className="flex items-center gap-2">
                    <Checkbox
                        id="deplete"
                        checked={deplete}
                        onCheckedChange={(v) => setDeplete(v === true)}
                    />
                    <Label htmlFor="deplete" className="font-normal">
                        Deplete limit on each draw (non-revolving)
                    </Label>
                </div>
                <Button type="submit" disabled={setLine.isPending || !assetId}>
                    {setLine.isPending ? "Saving…" : "Save credit line"}
                </Button>
            </form>

            <h2 className="mb-2 font-medium">Your lines</h2>
            {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
            ) : lines.length === 0 ? (
                <p className="text-muted-foreground text-sm">No credit lines yet.</p>
            ) : (
                <div className="overflow-x-auto rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Role</TableHead>
                                <TableHead>Counterparty</TableHead>
                                <TableHead>Asset</TableHead>
                                <TableHead className="text-right">Limit</TableHead>
                                <TableHead className="text-right">Exposure</TableHead>
                                <TableHead className="text-right">APR</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {lines.map((l) => {
                                const youCreditor = l.creditor === user;
                                return (
                                    <TableRow
                                        key={`${l.creditor}-${l.debtor}-${l.assetId}`}
                                    >
                                        <TableCell>
                                            {youCreditor ? "Creditor" : "Debtor"}
                                        </TableCell>
                                        <TableCell>
                                            {youCreditor ? l.debtor : l.creditor}
                                        </TableCell>
                                        <TableCell>
                                            {symbolOf(l.assetId)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {formatRawAmount(
                                                l.limit,
                                                precisionOf(l.assetId),
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {formatRawAmount(
                                                l.exposure,
                                                precisionOf(l.assetId),
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {ppmToPercent(l.interestRatePpm)}
                                            {l.depleteOnDebit ? " · deplete" : ""}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}

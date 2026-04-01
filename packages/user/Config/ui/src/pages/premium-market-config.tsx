import { useMemo, useState } from "react";

import { useAddPremiumMarket } from "@/hooks/use-add-premium-market";
import { usePremiumMarketsStatus } from "@/hooks/use-premium-markets-status";
import { useUpdatePremiumMarketStatus } from "@/hooks/use-update-premium-market-status";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Switch } from "@shared/shadcn/ui/switch";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@shared/shadcn/ui/table";

const MAX_MARKET_LENGTH = 15;

function parseMarketLength(raw: string): number | null {
    const t = raw.trim();
    if (!t) return null;
    if (t.length > MAX_MARKET_LENGTH) return null;
    if (!/^\d+$/.test(t)) return null;
    const n = Number.parseInt(t, 10);
    if (!Number.isFinite(n) || n < 1 || n > MAX_MARKET_LENGTH) return null;
    return n;
}

export const PremiumMarketConfig = () => {
    const { data: rows, isLoading, isError, error } = usePremiumMarketsStatus();
    const { mutate, isPending, variables } = useUpdatePremiumMarketStatus();
    const { mutate: addMarket, isPending: isAdding } = useAddPremiumMarket();

    const [newLengthRaw, setNewLengthRaw] = useState("");

    const parsedLength = useMemo(
        () => parseMarketLength(newLengthRaw),
        [newLengthRaw],
    );

    const trimmed = newLengthRaw.trim();
    const numericTooLarge =
        /^\d+$/.test(trimmed) &&
        Number.parseInt(trimmed, 10) > MAX_MARKET_LENGTH;

    const duplicate =
        parsedLength !== null &&
        (rows?.some((r) => r.length === parsedLength) ?? false);

    const canAdd = parsedLength !== null && !duplicate && !isAdding;

    return (
        <div className="mx-auto w-full max-w-screen-lg space-y-6 px-2">
            <div>
                <h2 className="text-lg font-medium">Premium Market Config</h2>
                <p className="text-muted-foreground text-sm">
                    Enable or disable new purchases for each premium account
                    name length (1-{MAX_MARKET_LENGTH}). Disabling a market
                    blocks new buys for that length; existing purchases can
                    still be claimed.
                </p>
            </div>

            <div className="flex max-w-md flex-col gap-3 rounded-lg border p-4">
                <div className="space-y-2">
                    <Label htmlFor="new-premium-market-length">
                        Add market (name length)
                    </Label>
                    <Input
                        id="new-premium-market-length"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={MAX_MARKET_LENGTH}
                        placeholder={`1-${MAX_MARKET_LENGTH}`}
                        value={newLengthRaw}
                        onChange={(e) => setNewLengthRaw(e.target.value)}
                        aria-invalid={
                            newLengthRaw.trim() !== "" &&
                            (parsedLength === null || duplicate)
                        }
                    />
                    {numericTooLarge ? (
                        <p className="text-destructive text-sm">
                            Market length cannot exceed {MAX_MARKET_LENGTH}.
                        </p>
                    ) : null}
                    {duplicate ? (
                        <p className="text-destructive text-sm">
                            A market for this length already exists.
                        </p>
                    ) : null}
                    {trimmed !== "" &&
                    parsedLength === null &&
                    !numericTooLarge ? (
                        <p className="text-destructive text-sm">
                            Enter a whole number from 1 to {MAX_MARKET_LENGTH}.
                        </p>
                    ) : null}
                </div>
                <Button
                    type="button"
                    disabled={!canAdd}
                    onClick={() => {
                        if (parsedLength === null) return;
                        addMarket([parsedLength], {
                            onSuccess: () => {
                                setNewLengthRaw("");
                            },
                        });
                    }}
                >
                    Add market
                </Button>
            </div>

            {isError ? (
                <p className="text-destructive text-sm">
                    {error instanceof Error
                        ? error.message
                        : "Could not load market status."}
                </p>
            ) : null}

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Market (account name length)</TableHead>
                        <TableHead className="w-[200px] text-right">
                            Purchases enabled
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                        <TableRow>
                            <TableCell
                                colSpan={3}
                                className="text-muted-foreground"
                            >
                                Loading…
                            </TableCell>
                        </TableRow>
                    ) : rows && rows.length > 0 ? (
                        rows.map((row) => {
                            const togglingThis =
                                isPending &&
                                variables &&
                                variables[0] === row.length;
                            return (
                                <TableRow key={row.length}>
                                    <TableCell className="font-mono">
                                        Length {row.length}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-3">
                                            <Switch
                                                id={`market-${row.length}`}
                                                checked={row.enabled}
                                                disabled={togglingThis}
                                                onCheckedChange={(enable) => {
                                                    mutate([
                                                        row.length,
                                                        enable,
                                                    ]);
                                                }}
                                            />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    ) : (
                        <TableRow>
                            <TableCell
                                colSpan={3}
                                className="text-muted-foreground"
                            >
                                No market data available.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    );
};

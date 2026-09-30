import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

import { AddAssetForm } from "@/components/add-asset-dialog";

import { useActivityFeed } from "@/hooks/use-banx-data";
import type { GroupedAccount } from "@/lib/account-groups";
import { formatRawAmount } from "@/lib/amount";
import {
    currencyMatches,
    currencyNet,
    currencyStatus,
    currencyUsage,
    precisionLabel,
    splitCurrencyUsage,
    type CurrencyUsage,
} from "@/lib/currency-usage";
import type { Asset } from "@/lib/graphql";

import { cn } from "@shared/lib/utils";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Input } from "@shared/shadcn/ui/input";

export function CurrencyPicker({
    assets,
    assetId,
    onAssetId,
    savings,
    loans,
    isLoading,
}: {
    assets: Asset[];
    assetId?: number;
    onAssetId: (id: number) => void;
    savings: GroupedAccount[];
    loans: GroupedAccount[];
    isLoading: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [createdSymbol, setCreatedSymbol] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const { data: events = [], isLoading: activityLoading } = useActivityFeed();
    const selected = assets.find((asset) => asset.id === assetId);
    const usage = useMemo(
        () => currencyUsage(assets, savings, loans, events),
        [assets, savings, loans, events],
    );
    const filtered = usage.filter((row) => currencyMatches(row, query));
    const { active, unused } = splitCurrencyUsage(filtered);
    const waiting = isLoading || activityLoading;

    const choose = (id: number) => {
        onAssetId(id);
        setOpen(false);
        setQuery("");
    };

    useEffect(() => {
        if (!createdSymbol) return;
        const created = assets.find(
            (asset) => asset.symbol.toLowerCase() === createdSymbol,
        );
        if (!created) return;
        onAssetId(created.id);
        setCreatedSymbol(null);
        setOpen(false);
        setQuery("");
    }, [assets, createdSymbol, onAssetId]);

    return (
        <>
            <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-between gap-3 px-3 py-2 text-left sm:w-56"
                aria-haspopup="dialog"
                aria-label={
                    selected
                        ? `Currency, ${selected.symbol.toUpperCase()}, ${selected.description}`
                        : "Choose a currency"
                }
                onClick={() => setOpen(true)}
            >
                <span className="min-w-0">
                    <span className="block font-mono text-sm font-semibold tracking-tight">
                        {selected ? selected.symbol.toUpperCase() : "Currency"}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs font-normal">
                        {selected?.description || "Choose a currency"}
                    </span>
                </span>
                <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
            </Button>
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) {
                        setQuery("");
                        setCreateOpen(false);
                    }
                }}
            >
                <DialogContent className="flex max-h-[min(85vh,40rem)] flex-col gap-3 sm:max-w-lg">
                    {createOpen ? (
                        <AddAssetForm
                            onCancel={() => setCreateOpen(false)}
                            onCreated={(symbol) => {
                                setCreatedSymbol(symbol);
                                setCreateOpen(false);
                            }}
                        />
                    ) : (
                        <>
                            <div className="flex items-start gap-3 pr-8">
                                <DialogHeader className="min-w-0 flex-1">
                                    <DialogTitle>Currency</DialogTitle>
                                    <DialogDescription>
                                        Currencies you hold, owe, or have a
                                        line in come first. The rest have no
                                        history on your account.
                                    </DialogDescription>
                                </DialogHeader>
                                <Button
                                    type="button"
                                    size="icon"
                                    className="size-8 shrink-0 rounded-full"
                                    aria-label="New asset"
                                    onClick={() => setCreateOpen(true)}
                                >
                                    <Plus className="size-4" />
                                </Button>
                            </div>
                            <Input
                                value={query}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                                placeholder="Search name or description"
                                aria-label="Search currencies"
                            />
                            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                                {waiting &&
                                usage.every((row) => !row.inUse) ? (
                                    <p className="text-muted-foreground text-sm">
                                        Loading…
                                    </p>
                                ) : filtered.length === 0 ? (
                                    <p className="text-muted-foreground text-sm">
                                        No currency matches that.
                                    </p>
                                ) : (
                                    <>
                                        <CurrencySection
                                            title="In use"
                                            rows={active}
                                            selectedId={assetId}
                                            onChoose={choose}
                                        />
                                        <CurrencySection
                                            title="No activity"
                                            rows={unused}
                                            selectedId={assetId}
                                            onChoose={choose}
                                            quiet
                                        />
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}

function CurrencySection({
    title,
    rows,
    selectedId,
    onChoose,
    quiet = false,
}: {
    title: string;
    rows: CurrencyUsage[];
    selectedId?: number;
    onChoose: (id: number) => void;
    quiet?: boolean;
}) {
    if (rows.length === 0) return null;
    return (
        <section>
            <h3 className="text-muted-foreground mb-1.5 px-1 text-[10px] font-medium tracking-wide uppercase sm:text-xs">
                {title}
                <span className="ml-1.5 font-normal tabular-nums">
                    {rows.length}
                </span>
            </h3>
            <ul className="space-y-0.5">
                {rows.map((row) => (
                    <li key={row.asset.id}>
                        <CurrencyRow
                            row={row}
                            selected={row.asset.id === selectedId}
                            quiet={quiet}
                            onChoose={onChoose}
                        />
                    </li>
                ))}
            </ul>
        </section>
    );
}

function CurrencyRow({
    row,
    selected,
    quiet,
    onChoose,
}: {
    row: CurrencyUsage;
    selected: boolean;
    quiet: boolean;
    onChoose: (id: number) => void;
}) {
    const symbol = row.asset.symbol.toUpperCase();
    const status = currencyStatus(row);
    const net = currencyNet(row);
    const netText =
        net === null
            ? null
            : net > 0n
              ? `+${formatRawAmount(net.toString(), row.asset.precision)}`
              : formatRawAmount(net.toString(), row.asset.precision);
    const description =
        row.asset.description.trim() || "No description";
    return (
        <button
            type="button"
            className={cn(
                "flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left",
                selected ? "bg-muted" : "hover:bg-muted/60",
            )}
            aria-pressed={selected}
            onClick={() => onChoose(row.asset.id)}
        >
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                    <span
                        className={cn(
                            "font-mono text-sm font-semibold tracking-tight",
                            quiet && "text-muted-foreground font-medium",
                        )}
                    >
                        {symbol}
                    </span>
                    {netText ? (
                        <span
                            className={cn(
                                "font-mono text-sm font-semibold tabular-nums",
                                net !== null && net < 0n
                                    ? "text-amber-900 dark:text-amber-300"
                                    : "text-emerald-800 dark:text-emerald-300",
                            )}
                        >
                            {netText}
                        </span>
                    ) : null}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">
                    {description}
                    <span className="mx-1.5 opacity-40">·</span>
                    {precisionLabel(row.asset.precision)}
                </span>
                {status ? (
                    <span className="mt-0.5 block text-xs leading-snug">
                        {status}
                    </span>
                ) : null}
            </span>
            {selected ? (
                <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
                <span className="size-4 shrink-0" aria-hidden />
            )}
        </button>
    );
}

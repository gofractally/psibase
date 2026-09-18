import type { ConsumptionEvent, ResourceKind } from "@/lib/user-queries";
import type { LucideIcon } from "lucide-react";

import { Cpu, HardDrive, Network } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { TimeAgo } from "@/components/time-ago";

import { formatBytes, formatNumber } from "@/lib/format";

import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface Props {
    events: ConsumptionEvent[] | undefined;
    symbol: string;
    precision: number;
    isPending?: boolean;
    isError?: boolean;
    errorMessage?: string;
    recent?: number;
}

const META: Record<
    ResourceKind,
    {
        label: string;
        icon: LucideIcon;
        color: string;
        format: (n: number) => string;
    }
> = {
    CPU: {
        label: "CPU",
        icon: Cpu,
        color: "var(--chart-1)",
        format: (ms) =>
            ms < 1000
                ? `${formatNumber(ms)} ms`
                : `${(ms / 1000).toFixed(2)} s`,
    },
    NET: {
        label: "Network",
        icon: Network,
        color: "var(--chart-2)",
        format: (bytes) => formatBytes(Math.abs(bytes)),
    },
    DISK: {
        label: "Storage",
        icon: HardDrive,
        color: "var(--chart-4)",
        format: (bytes) =>
            `${bytes < 0 ? "−" : ""}${formatBytes(Math.abs(bytes))}`,
    },
};

const ORDER: ResourceKind[] = ["CPU", "NET", "DISK"];

const formatCost = (value: number, precision: number) => {
    const digits = Math.min(precision, 6);
    const abs = Math.abs(value);
    if (abs !== 0 && abs < 10 ** -digits)
        return `<${(10 ** -digits).toFixed(digits)}`;
    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: digits,
    }).format(value);
};

/**
 * Aggregates the user's recent consumption events by resource, shows what
 * share of spend each resource represents, and lists the latest charges.
 */
export const ConsumptionBreakdown = ({
    events,
    symbol,
    precision,
    isPending,
    isError,
    errorMessage,
    recent = 8,
}: Props) => {
    const totals = useMemo(() => {
        const acc: Record<
            ResourceKind,
            { amount: number; cost: number; events: number }
        > = {
            CPU: { amount: 0, cost: 0, events: 0 },
            NET: { amount: 0, cost: 0, events: 0 },
            DISK: { amount: 0, cost: 0, events: 0 },
        };
        for (const e of events ?? []) {
            acc[e.resource].amount += e.amount;
            acc[e.resource].cost += Number(e.cost) || 0;
            acc[e.resource].events++;
        }
        const spend = ORDER.reduce((n, k) => n + Math.max(0, acc[k].cost), 0);
        return { acc, spend };
    }, [events]);

    if (isPending) {
        return (
            <div className="flex flex-col gap-3 p-4">
                <div className="grid gap-3 sm:grid-cols-3">
                    {ORDER.map((k) => (
                        <Skeleton key={k} className="h-20" />
                    ))}
                </div>
                <Skeleton className="h-3 w-full" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-1 p-4 text-center text-sm">
                <span>Could not load consumption history</span>
                {errorMessage && (
                    <span className="max-w-md break-all font-mono text-xs opacity-70">
                        {errorMessage}
                    </span>
                )}
            </div>
        );
    }

    if (!events || events.length === 0) {
        return (
            <div className="text-muted-foreground flex h-40 items-center justify-center p-4 text-center text-sm">
                No metered consumption yet. Sending a transaction will produce
                your first CPU, network and storage charges.
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            <div className="grid gap-3 p-4 sm:grid-cols-3">
                {ORDER.map((k) => {
                    const m = META[k];
                    const t = totals.acc[k];
                    const share =
                        totals.spend > 0
                            ? (Math.max(0, t.cost) / totals.spend) * 100
                            : 0;
                    return (
                        <div
                            key={k}
                            className="bg-background/40 relative overflow-hidden rounded-lg border p-3"
                        >
                            <div
                                aria-hidden
                                className="pointer-events-none absolute -right-8 -top-8 size-20 rounded-full opacity-[0.14] blur-xl"
                                style={{ backgroundColor: m.color }}
                            />
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider">
                                    <m.icon
                                        className="size-3.5"
                                        style={{ color: m.color }}
                                    />
                                    {m.label}
                                </span>
                                <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                                    {t.events}{" "}
                                    {t.events === 1 ? "event" : "events"}
                                </span>
                            </div>
                            <div className="mt-1 text-lg font-semibold tabular-nums tracking-tight">
                                {t.events ? m.format(t.amount) : "—"}
                            </div>
                            <div className="text-muted-foreground mt-0.5 flex items-center justify-between text-xs tabular-nums">
                                <span>
                                    {t.cost < 0 ? "refund " : "cost "}
                                    <span className="text-foreground/80 font-mono">
                                        {formatCost(
                                            Math.abs(t.cost),
                                            precision,
                                        )}{" "}
                                        {symbol}
                                    </span>
                                </span>
                                <span className="opacity-70">
                                    {share.toFixed(0)}%
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="px-4 pb-3">
                <div className="bg-muted/60 flex h-2 w-full overflow-hidden rounded-full">
                    {ORDER.map((k) => {
                        const share =
                            totals.spend > 0
                                ? (Math.max(0, totals.acc[k].cost) /
                                      totals.spend) *
                                  100
                                : 0;
                        return (
                            <div
                                key={k}
                                className="h-full transition-[width] duration-500"
                                style={{
                                    width: `${share}%`,
                                    backgroundColor: META[k].color,
                                }}
                                title={`${META[k].label} ${share.toFixed(1)}%`}
                            />
                        );
                    })}
                </div>
                <div className="text-muted-foreground mt-1.5 flex justify-between text-[11px]">
                    <span>
                        Share of spend across the last{" "}
                        {formatNumber(events.length)} events
                    </span>
                    <span className="font-mono tabular-nums">
                        total {formatCost(totals.spend, precision)} {symbol}
                    </span>
                </div>
            </div>

            <div className="border-t">
                <table className="w-full text-[13px]">
                    <thead className="bg-muted/30 border-b">
                        <tr className="text-muted-foreground text-left text-[11px] font-medium uppercase tracking-wider">
                            <th className="h-8 px-4">Resource</th>
                            <th className="h-8 px-3 text-right">Amount</th>
                            <th className="h-8 px-3 text-right">Cost</th>
                            <th className="h-8 px-3">Block</th>
                            <th className="h-8 px-3">When</th>
                        </tr>
                    </thead>
                    <tbody>
                        {events.slice(0, recent).map((e, i) => {
                            const m = META[e.resource];
                            const cost = Number(e.cost) || 0;
                            return (
                                <tr
                                    key={`${e.blockNum}-${i}`}
                                    className="hover:bg-accent/40 border-b transition-colors last:border-b-0"
                                >
                                    <td className="px-4 py-1.5">
                                        <span className="inline-flex items-center gap-1.5">
                                            <m.icon
                                                className="size-3.5"
                                                style={{ color: m.color }}
                                            />
                                            {m.label}
                                        </span>
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                        {m.format(e.amount)}
                                    </td>
                                    <td
                                        className={cn(
                                            "px-3 py-1.5 text-right font-mono tabular-nums",
                                            cost < 0 && "text-emerald-500",
                                        )}
                                    >
                                        {cost < 0 ? "+" : "−"}
                                        {formatCost(Math.abs(cost), precision)}
                                    </td>
                                    <td className="px-3 py-1.5">
                                        {e.blockNum !== null ? (
                                            <Link
                                                to={`/blocks/${e.blockNum}`}
                                                className="text-primary font-mono tabular-nums hover:underline"
                                            >
                                                {formatNumber(e.blockNum)}
                                            </Link>
                                        ) : (
                                            <span className="text-muted-foreground">
                                                —
                                            </span>
                                        )}
                                    </td>
                                    <td className="text-muted-foreground px-3 py-1.5">
                                        {e.blockTime ? (
                                            <TimeAgo time={e.blockTime} />
                                        ) : (
                                            "—"
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

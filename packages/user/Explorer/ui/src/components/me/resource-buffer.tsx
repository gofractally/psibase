import type { UserResources } from "@/lib/user-queries";

import { Fuel } from "lucide-react";

import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface Props {
    resources: UserResources | null | undefined;
    symbol: string;
    precision: number;
    isPending?: boolean;
    className?: string;
}

export const formatUnits = (value: number, precision: number) =>
    new Intl.NumberFormat("en-US", {
        maximumFractionDigits: Math.min(precision, 4),
    }).format(value);

/**
 * The user's prepaid resource buffer ("gas tank") drawn as a horizontal
 * gauge. The auto-fill threshold is marked so it is obvious when a refill
 * would be triggered by client tooling.
 */
export const ResourceBuffer = ({
    resources,
    symbol,
    precision,
    isPending,
    className,
}: Props) => {
    if (isPending || !resources) {
        return (
            <div className={cn("flex flex-col gap-3", className)}>
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-3 w-56" />
            </div>
        );
    }

    const { balance, bufferCapacity, autoFillThresholdPercent } = resources;
    const ratio = bufferCapacity > 0 ? balance / bufferCapacity : 0;
    const fill = Math.max(0, Math.min(100, ratio * 100));
    const threshold = Math.max(0, Math.min(100, autoFillThresholdPercent));
    const low = threshold > 0 && fill <= threshold;
    const empty = bufferCapacity === 0;

    const tone = empty
        ? "var(--muted-foreground)"
        : low
          ? "var(--chart-5)"
          : fill < 50
            ? "var(--chart-3)"
            : "var(--chart-2)";

    return (
        <div className={cn("flex flex-col gap-3", className)}>
            <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-semibold tabular-nums tracking-tight">
                        {formatUnits(balance, precision)}
                    </span>
                    <span className="text-muted-foreground text-sm">
                        / {formatUnits(bufferCapacity, precision)} {symbol}
                    </span>
                </div>
                <span
                    className="rounded-md px-2 py-0.5 font-mono text-xs tabular-nums"
                    style={{
                        color: tone,
                        backgroundColor: `color-mix(in oklch, ${tone} 14%, transparent)`,
                    }}
                >
                    {empty
                        ? "no buffer"
                        : `${fill.toFixed(fill < 10 ? 1 : 0)}% full`}
                </span>
            </div>

            <div
                className="bg-muted/60 relative h-5 w-full overflow-hidden rounded-md border"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(fill)}
                aria-label="Resource buffer"
            >
                <div
                    className="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
                    style={{
                        width: `${fill}%`,
                        background: `linear-gradient(90deg, color-mix(in oklch, ${tone} 55%, transparent), ${tone})`,
                        boxShadow: `0 0 12px color-mix(in oklch, ${tone} 45%, transparent)`,
                    }}
                />
                {threshold > 0 && (
                    <div
                        aria-hidden
                        className="border-foreground/60 absolute inset-y-0 w-px border-l border-dashed"
                        style={{ left: `${threshold}%` }}
                        title={`Auto-fill threshold ${threshold}%`}
                    />
                )}
            </div>

            <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5">
                    <Fuel className="size-3.5" />
                    {empty
                        ? "Set a buffer capacity to start prepaying for resources"
                        : low
                          ? "Below the auto-fill threshold; your next transaction may trigger a refill"
                          : "Every transaction you send draws CPU, network and disk from this buffer"}
                </span>
                {threshold > 0 ? (
                    <span className="font-mono tabular-nums">
                        auto-fill at {threshold}%
                    </span>
                ) : (
                    <span>auto-fill off</span>
                )}
            </div>
        </div>
    );
};

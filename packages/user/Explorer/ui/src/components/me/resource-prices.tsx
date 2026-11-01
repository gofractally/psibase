import type { RateLimitPricing, ResourcePricing } from "@/lib/user-queries";

import { Cpu, HardDrive, Network } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

import { formatBytes, formatNumber, pct } from "@/lib/format";

import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface Props {
    pricing: ResourcePricing | undefined;
    symbol: string;
    precision: number;
    isPending: boolean;
    isError: boolean;
}

/** Format an amount expressed in system-token base units as a human-readable decimal. */
const fromBaseUnits = (amount: number, precision: number) => {
    const value = amount / 10 ** precision;
    if (value === 0) return "0";
    if (value < 0.0001) return value.toExponential(2);
    return new Intl.NumberFormat("en-US", {
        maximumSignificantDigits: 4,
    }).format(value);
};

/**
 * Price of a human-sized quantity (1 ms of CPU, 1 KiB of bandwidth) derived
 * from the service's per-billable-unit price.
 */
const pricePer = (
    p: RateLimitPricing,
    quantityInBillableUnits: number,
    precision: number,
) => fromBaseUnits(p.pricePerUnit * quantityInBillableUnits, precision);

const usageOf = (p: RateLimitPricing) => {
    const usage = Number(p.avgUsagePct);
    const idle = Number(p.thresholds.idlePct);
    const congested = Number(p.thresholds.congestedPct);
    const trend =
        usage >= congested
            ? ("rising" as const)
            : usage <= idle
              ? ("falling" as const)
              : ("steady" as const);
    return { usage, idle, congested, trend };
};

const TREND_LABEL = {
    rising: { text: "price rising", className: "text-rose-500" },
    falling: { text: "price falling", className: "text-emerald-500" },
    steady: { text: "price steady", className: "text-muted-foreground" },
};

const RateRow = ({
    icon: Icon,
    label,
    price,
    unitLabel,
    pricing,
}: {
    icon: typeof Cpu;
    label: string;
    price: string;
    unitLabel: string;
    pricing: RateLimitPricing;
}) => {
    const { usage, idle, congested, trend } = usageOf(pricing);
    const t = TREND_LABEL[trend];
    return (
        <li className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm">
                    <Icon className="text-muted-foreground size-4" />
                    {label}
                </span>
                <span className="font-mono text-sm tabular-nums">
                    {price}
                    <span className="text-muted-foreground ml-1 text-xs">
                        / {unitLabel}
                    </span>
                </span>
            </div>
            <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
                <div
                    className={cn(
                        "h-full rounded-full",
                        trend === "rising"
                            ? "bg-rose-500"
                            : trend === "falling"
                              ? "bg-emerald-500"
                              : "bg-[var(--chart-2)]",
                    )}
                    style={{ width: `${Math.min(100, Math.max(0, usage))}%` }}
                />
                {[idle, congested].map((mark) => (
                    <span
                        key={mark}
                        className="bg-foreground/40 absolute top-0 h-full w-px"
                        style={{ left: `${Math.min(100, Math.max(0, mark))}%` }}
                    />
                ))}
            </div>
            <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                <span>
                    {usage.toFixed(usage < 10 ? 1 : 0)}% of network capacity in
                    use
                </span>
                <span className={t.className}>{t.text}</span>
            </div>
        </li>
    );
};

/**
 * What the network is currently charging for the resources this user's
 * transactions consume. Public market data, so it is shown even before the
 * user grants Explorer access to their own buffer.
 */
export const ResourcePrices = ({
    pricing,
    symbol,
    precision,
    isPending,
    isError,
}: Props) => {
    if (isPending) {
        return (
            <div className="flex flex-col gap-3 p-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
            </div>
        );
    }
    if (isError || !pricing) {
        return <EmptyState>Pricing is not available right now</EmptyState>;
    }

    const { cpu, net, disk } = pricing;
    const diskUsed = disk ? disk.maxCapacity - disk.remainingCapacity : 0;

    return (
        <ul className="divide-y">
            {cpu && (
                <RateRow
                    icon={Cpu}
                    label="CPU time"
                    // billableUnit is in nanoseconds; price 1 ms of compute
                    price={`${pricePer(cpu, 1_000_000 / cpu.billableUnit, precision)} ${symbol}`}
                    unitLabel="ms"
                    pricing={cpu}
                />
            )}
            {net && (
                <RateRow
                    icon={Network}
                    label="Bandwidth"
                    // billableUnit is in bits; price 1 KiB of traffic
                    price={`${pricePer(net, (1024 * 8) / net.billableUnit, precision)} ${symbol}`}
                    unitLabel="KiB"
                    pricing={net}
                />
            )}
            {disk && (
                <li className="flex flex-col gap-1.5 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm">
                            <HardDrive className="text-muted-foreground size-4" />
                            Storage
                        </span>
                        <span className="font-mono text-sm tabular-nums">
                            {disk.costPerMiB} {symbol}
                            <span className="text-muted-foreground ml-1 text-xs">
                                / MiB
                            </span>
                        </span>
                    </div>
                    <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
                        <div
                            className="h-full rounded-full bg-[var(--chart-4)]"
                            style={{
                                width: disk.maxCapacity
                                    ? `${(diskUsed / disk.maxCapacity) * 100}%`
                                    : "0%",
                            }}
                        />
                    </div>
                    <div className="text-muted-foreground flex items-center justify-between text-[11px]">
                        <span>
                            {formatBytes(diskUsed)} of{" "}
                            {formatBytes(disk.maxCapacity)} allocated (
                            {pct(diskUsed, disk.maxCapacity, 0)})
                        </span>
                        <span>
                            {formatNumber(disk.remainingCapacity)} bytes free ·
                            refundable when freed
                        </span>
                    </div>
                </li>
            )}
        </ul>
    );
};

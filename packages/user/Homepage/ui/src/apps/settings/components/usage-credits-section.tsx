import { Sparkles, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { KeyValue, Panel } from "@/components/page-header";

import { useBranding } from "@shared/hooks/use-branding";
import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import {
    useResizeAndTopUpCredits,
    useTopUpCredits,
} from "../hooks/use-top-up-credits";
import { levelTone, useUsageCredits } from "../hooks/use-usage-credits";
import { UsageMeter } from "./usage-meter";

const formatAmount = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: 4 });

export const UsageCreditsSection = () => {
    const { data: networkName } = useBranding();
    const { enabled, isLoading, resources, error, level, symbol } =
        useUsageCredits();
    const { mutateAsync: topUp, isPending: isToppingUp } = useTopUpCredits();
    const { mutateAsync: resizeAndTopUp, isPending: isResizing } =
        useResizeAndTopUpCredits();

    const originalCapacity = resources ? String(resources.bufferCapacity) : "0";
    const [capacity, setCapacity] = useState(originalCapacity);
    useEffect(() => setCapacity(originalCapacity), [originalCapacity]);

    const capacityChanged = capacity !== originalCapacity && capacity !== "";
    const isPending = isToppingUp || isResizing;
    const disabled = !enabled || isPending || isLoading;

    const onTopUp = async () => {
        try {
            if (capacityChanged) await resizeAndTopUp(capacity);
            else await topUp();
        } catch {
            // surfaced by the mutation's onError toast
        }
    };

    if (!isLoading && !enabled) {
        return (
            <Panel>
                <EmptyState
                    icon={Sparkles}
                    className="min-h-40"
                    detail={`There's no charge for activity on ${networkName || "this network"} right now, so there's nothing to top up.`}
                >
                    Usage is free here
                </EmptyState>
            </Panel>
        );
    }

    const amount = (n: number | undefined) =>
        isLoading ? (
            <Skeleton className="h-4 w-24" />
        ) : n === undefined ? (
            <span className="text-muted-foreground">—</span>
        ) : (
            <span className="font-mono tabular-nums">
                {formatAmount(n)}{" "}
                <span className="text-muted-foreground text-xs">{symbol}</span>
            </span>
        );

    return (
        <div className="flex flex-col gap-4">
            <Panel>
                <div className="flex flex-col gap-3 p-4">
                    <div className="flex items-end justify-between gap-3">
                        <div>
                            <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                                Credits remaining
                            </div>
                            <div
                                className="mt-1 text-3xl font-semibold tabular-nums tracking-tight"
                                style={{ color: levelTone(level) }}
                            >
                                {isLoading ? (
                                    <Skeleton className="h-8 w-20" />
                                ) : (
                                    `${Math.round(level)}%`
                                )}
                            </div>
                        </div>
                        <Zap
                            className="size-6 opacity-70"
                            style={{ color: levelTone(level) }}
                        />
                    </div>
                    <UsageMeter level={level} />
                    <p className="text-muted-foreground text-xs leading-relaxed">
                        Everything you do in apps on{" "}
                        {networkName || "the network"} — sending tokens,
                        messages, updating your profile — uses a little of your
                        credits. They top up automatically from your{" "}
                        {symbol ?? "token"} balance when they run low.
                    </p>
                </div>
            </Panel>

            <Panel title="Details">
                <KeyValue label="Available">
                    {amount(resources?.balance)}
                </KeyValue>
                <KeyValue label="Reserve size">
                    {amount(resources?.bufferCapacity)}
                </KeyValue>
                <KeyValue label="Auto top-up">
                    {isLoading ? (
                        <Skeleton className="h-4 w-16" />
                    ) : resources ? (
                        <span>
                            when below{" "}
                            <span className="font-mono tabular-nums">
                                {resources.autoFillThresholdPercent}%
                            </span>
                        </span>
                    ) : (
                        <span className="text-muted-foreground">—</span>
                    )}
                </KeyValue>
                {error && (
                    <div className="text-destructive px-4 py-2 text-xs">
                        {error.message}
                    </div>
                )}
            </Panel>

            <Panel
                title="Top up now"
                description="Refill to your reserve size, or change the size first"
            >
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
                    <div className="flex flex-1 flex-col gap-1.5">
                        <Label
                            htmlFor="reserve-size"
                            className="text-muted-foreground text-xs"
                        >
                            Reserve size
                        </Label>
                        <div className="flex items-center gap-2">
                            <Input
                                id="reserve-size"
                                type="number"
                                min="0"
                                step="any"
                                value={capacity}
                                onChange={(e) => setCapacity(e.target.value)}
                                disabled={disabled}
                                className="h-8 font-mono text-sm tabular-nums"
                            />
                            <span className="text-muted-foreground font-mono text-xs">
                                {symbol}
                            </span>
                        </div>
                    </div>
                    <Button
                        size="sm"
                        className="h-8"
                        onClick={onTopUp}
                        disabled={disabled}
                    >
                        <Zap className="size-3.5" />
                        {isPending
                            ? "Topping up…"
                            : capacityChanged
                              ? "Resize & top up"
                              : "Top up"}
                    </Button>
                </div>
            </Panel>
        </div>
    );
};

import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import type { BlockPoint } from "@/store/live-chain";
import { formatClock, formatNumber } from "@/lib/format";

interface Props {
    series: BlockPoint[];
    height?: number;
    showInterval?: boolean;
}

interface TooltipPayload {
    payload?: BlockPoint;
}

const ChartTooltip = ({
    active,
    payload,
}: {
    active?: boolean;
    payload?: TooltipPayload[];
}) => {
    if (!active || !payload?.length || !payload[0].payload) return null;
    const p = payload[0].payload;
    return (
        <div className="bg-popover text-popover-foreground rounded-lg border px-3 py-2 text-xs shadow-xl">
            <div className="mb-1 flex items-center justify-between gap-4 font-mono">
                <span className="font-semibold">#{formatNumber(p.blockNum)}</span>
                <span className="text-muted-foreground">
                    {formatClock(new Date(p.time))}
                </span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <span className="text-muted-foreground">Transactions</span>
                <span className="text-right tabular-nums">{p.userTxs}</span>
                <span className="text-muted-foreground">Actions</span>
                <span className="text-right tabular-nums">{p.actions}</span>
                <span className="text-muted-foreground">Interval</span>
                <span className="text-right tabular-nums">
                    {p.interval === null ? "—" : `${p.interval.toFixed(2)}s`}
                </span>
                <span className="text-muted-foreground">Producer</span>
                <span className="text-right font-mono">{p.producer}</span>
            </div>
        </div>
    );
};

export const BlockActivityChart = ({
    series,
    height = 220,
    showInterval = true,
}: Props) => {
    return (
        <div style={{ height }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                    data={series}
                    margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
                >
                    <defs>
                        <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop
                                offset="0%"
                                stopColor="var(--chart-1)"
                                stopOpacity={0.95}
                            />
                            <stop
                                offset="100%"
                                stopColor="var(--chart-1)"
                                stopOpacity={0.35}
                            />
                        </linearGradient>
                    </defs>
                    <CartesianGrid
                        vertical={false}
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                    />
                    <XAxis
                        dataKey="time"
                        tickFormatter={(t: number) => formatClock(new Date(t))}
                        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={48}
                    />
                    <YAxis
                        yAxisId="left"
                        allowDecimals={false}
                        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                    />
                    {showInterval && (
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{
                                fontSize: 10,
                                fill: "var(--muted-foreground)",
                            }}
                            axisLine={false}
                            tickLine={false}
                            width={40}
                            tickFormatter={(v: number) => `${v}s`}
                            domain={[0, (max: number) => Math.max(2, Math.ceil(max))]}
                        />
                    )}
                    <Tooltip
                        content={<ChartTooltip />}
                        cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                    />
                    <Bar
                        yAxisId="left"
                        dataKey="userTxs"
                        name="Transactions"
                        fill="url(#txGrad)"
                        radius={[2, 2, 0, 0]}
                        isAnimationActive={false}
                        maxBarSize={14}
                    />
                    {showInterval && (
                        <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="interval"
                            name="Block interval"
                            stroke="var(--chart-2)"
                            strokeWidth={1.5}
                            dot={false}
                            isAnimationActive={false}
                            connectNulls
                        />
                    )}
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

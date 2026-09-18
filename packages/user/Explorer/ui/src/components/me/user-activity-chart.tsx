import type { ActivityPoint } from "@/hooks/use-user-dashboard";

import {
    Bar,
    BarChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { formatClock } from "@/lib/format";

interface Props {
    series: ActivityPoint[];
    showReceived?: boolean;
    height?: number;
}

const ChartTooltip = ({
    active,
    payload,
    showReceived,
}: {
    active?: boolean;
    payload?: { payload?: ActivityPoint }[];
    showReceived: boolean;
}) => {
    if (!active || !payload?.length || !payload[0].payload) return null;
    const p = payload[0].payload;
    return (
        <div className="bg-popover text-popover-foreground rounded-lg border px-3 py-2 text-xs shadow-xl">
            <div className="text-muted-foreground mb-1 font-mono">
                {formatClock(new Date(p.time))}
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <span className="text-muted-foreground">Actions sent</span>
                <span className="text-right tabular-nums">{p.sent}</span>
                {showReceived && (
                    <>
                        <span className="text-muted-foreground">
                            Calls received
                        </span>
                        <span className="text-right tabular-nums">
                            {p.received}
                        </span>
                    </>
                )}
            </div>
        </div>
    );
};

/** Time-bucketed bars of the user's actions across the live window. */
export const UserActivityChart = ({
    series,
    showReceived = false,
    height = 200,
}: Props) => (
    <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
            <BarChart
                data={series}
                margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
                barGap={1}
            >
                <defs>
                    <linearGradient id="meSent" x1="0" y1="0" x2="0" y2="1">
                        <stop
                            offset="0%"
                            stopColor="var(--chart-2)"
                            stopOpacity={0.95}
                        />
                        <stop
                            offset="100%"
                            stopColor="var(--chart-2)"
                            stopOpacity={0.35}
                        />
                    </linearGradient>
                    <linearGradient id="meRecv" x1="0" y1="0" x2="0" y2="1">
                        <stop
                            offset="0%"
                            stopColor="var(--chart-4)"
                            stopOpacity={0.95}
                        />
                        <stop
                            offset="100%"
                            stopColor="var(--chart-4)"
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
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                />
                <Tooltip
                    content={<ChartTooltip showReceived={showReceived} />}
                    cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                />
                <Bar
                    dataKey="sent"
                    name="Actions sent"
                    stackId="a"
                    fill="url(#meSent)"
                    radius={showReceived ? 0 : [2, 2, 0, 0]}
                    isAnimationActive={false}
                    maxBarSize={18}
                />
                {showReceived && (
                    <Bar
                        dataKey="received"
                        name="Calls received"
                        stackId="a"
                        fill="url(#meRecv)"
                        radius={[2, 2, 0, 0]}
                        isAnimationActive={false}
                        maxBarSize={18}
                    />
                )}
            </BarChart>
        </ResponsiveContainer>
    </div>
);

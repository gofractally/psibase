import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { colorFor } from "@/lib/colors";
import { formatNumber, pct } from "@/lib/format";

import { AccountLink } from "@/components/account-link";

interface Props {
    data: { service: string; count: number }[];
    max?: number;
    height?: number;
}

export const ServiceActivityChart = ({ data, max = 8, height = 200 }: Props) => {
    const total = data.reduce((a, b) => a + b.count, 0);
    const top = data.slice(0, max);
    const rest = data.slice(max).reduce((a, b) => a + b.count, 0);
    const slices = rest > 0 ? [...top, { service: "other", count: rest }] : top;

    if (total === 0) {
        return (
            <div
                className="text-muted-foreground flex items-center justify-center text-sm"
                style={{ height }}
            >
                No user actions in the current window
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div style={{ height, width: height }} className="shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={slices}
                            dataKey="count"
                            nameKey="service"
                            innerRadius="62%"
                            outerRadius="92%"
                            paddingAngle={2}
                            strokeWidth={0}
                            isAnimationActive={false}
                        >
                            {slices.map((s) => (
                                <Cell
                                    key={s.service}
                                    fill={
                                        s.service === "other"
                                            ? "var(--muted-foreground)"
                                            : colorFor(s.service, 70, 60)
                                    }
                                />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(value: number, name: string) => [
                                `${formatNumber(value)} (${pct(value, total)})`,
                                name,
                            ]}
                            contentStyle={{
                                background: "var(--popover)",
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                fontSize: 12,
                            }}
                            itemStyle={{ color: "var(--foreground)" }}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <ul className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                {slices.map((s) => (
                    <li
                        key={s.service}
                        className="flex items-center justify-between gap-2"
                    >
                        <span className="flex min-w-0 items-center gap-2">
                            <span
                                className="size-2 shrink-0 rounded-sm"
                                style={{
                                    backgroundColor:
                                        s.service === "other"
                                            ? "var(--muted-foreground)"
                                            : colorFor(s.service, 70, 60),
                                }}
                            />
                            {s.service === "other" ? (
                                <span className="text-muted-foreground">
                                    other
                                </span>
                            ) : (
                                <AccountLink name={s.service} dot={false} />
                            )}
                        </span>
                        <span className="text-muted-foreground shrink-0 tabular-nums">
                            {formatNumber(s.count)}{" "}
                            <span className="opacity-60">
                                · {pct(s.count, total, 0)}
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

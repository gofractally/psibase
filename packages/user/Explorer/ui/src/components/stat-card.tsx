import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { cn } from "@shared/lib/utils";

interface StatCardProps {
    label: string;
    value: ReactNode;
    sub?: ReactNode;
    icon?: LucideIcon;
    accent?: string;
    spark?: number[];
    className?: string;
    children?: ReactNode;
}

export const Sparkline = ({
    data,
    color = "var(--chart-2)",
    className,
}: {
    data: number[];
    color?: string;
    className?: string;
}) => {
    const points = data.map((v, i) => ({ i, v }));
    const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
    return (
        <div className={cn("h-10 w-full", className)}>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                    data={points}
                    margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
                >
                    <defs>
                        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                            <stop
                                offset="0%"
                                stopColor={color}
                                stopOpacity={0.45}
                            />
                            <stop
                                offset="100%"
                                stopColor={color}
                                stopOpacity={0}
                            />
                        </linearGradient>
                    </defs>
                    <Area
                        type="monotone"
                        dataKey="v"
                        stroke={color}
                        strokeWidth={1.5}
                        fill={`url(#${id})`}
                        isAnimationActive={false}
                        dot={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};

export const StatCard = ({
    label,
    value,
    sub,
    icon: Icon,
    accent = "var(--chart-2)",
    spark,
    className,
    children,
}: StatCardProps) => {
    return (
        <div
            className={cn(
                "bg-card/70 relative flex flex-col overflow-hidden rounded-xl border p-4 shadow-sm backdrop-blur",
                className,
            )}
        >
            <div
                aria-hidden
                className="pointer-events-none absolute -top-12 -right-12 size-32 rounded-full opacity-[0.12] blur-2xl"
                style={{ backgroundColor: accent }}
            />
            <div className="flex items-start justify-between gap-2">
                <div className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                    {label}
                </div>
                {Icon && (
                    <Icon
                        className="size-4 shrink-0 opacity-70"
                        style={{ color: accent }}
                    />
                )}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {value}
            </div>
            {sub && (
                <div className="text-muted-foreground mt-0.5 text-xs">
                    {sub}
                </div>
            )}
            {spark && spark.length > 1 && (
                <Sparkline data={spark} color={accent} className="mt-2" />
            )}
            {children}
        </div>
    );
};

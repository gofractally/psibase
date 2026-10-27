import type { LucideIcon } from "lucide-react";

import { type ReactNode, useLayoutEffect, useRef } from "react";

import { cn } from "@shared/lib/utils";

interface StatCardProps {
    label: ReactNode;
    value: ReactNode;
    sub?: ReactNode;
    icon?: LucideIcon;
    accent?: string;
    spark?: number[];
    className?: string;
    children?: ReactNode;
}

const SPARK_HEIGHT = 40;
const SPARK_TOP_MARGIN = 2;

export const Sparkline = ({
    data,
    color = "var(--chart-2)",
    className,
}: {
    data: number[];
    color?: string;
    className?: string;
}) => {
    const max = Math.max(1, ...data);
    const step = 100 / Math.max(1, data.length - 1);
    const points = data
        .map(
            (v, i) =>
                `${i * step},${SPARK_HEIGHT - (v / max) * (SPARK_HEIGHT - SPARK_TOP_MARGIN)}`,
        )
        .join(" ");
    const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
    return (
        <svg
            aria-hidden
            viewBox={`0 0 100 ${SPARK_HEIGHT}`}
            preserveAspectRatio="none"
            className={cn("h-10 w-full", className)}
        >
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
            </defs>
            <polygon
                points={`0,${SPARK_HEIGHT} ${points} 100,${SPARK_HEIGHT}`}
                fill={`url(#${id})`}
            />
            <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
};

/** Smallest scale a headline value may shrink to before it is clipped instead. */
const MIN_VALUE_SCALE = 0.5;

/**
 * Renders a single-line headline value and shrinks its font size so it fits
 * the card's width. Long numbers (e.g. "999,999.9999 PSI") would otherwise
 * be clipped at narrow card widths.
 */
const FitValue = ({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) => {
    const outer = useRef<HTMLDivElement>(null);
    const inner = useRef<HTMLSpanElement>(null);

    useLayoutEffect(() => {
        const o = outer.current;
        const i = inner.current;
        if (!o || !i) return;

        const fit = () => {
            i.style.fontSize = "";
            const available = o.clientWidth;
            const needed = i.scrollWidth;
            if (available > 0 && needed > available) {
                const scale = Math.max(MIN_VALUE_SCALE, available / needed);
                i.style.fontSize = `${scale}em`;
            }
        };

        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(o);
        return () => observer.disconnect();
    });

    return (
        <div ref={outer} className={cn("min-w-0 overflow-hidden", className)}>
            <span
                ref={inner}
                className="inline-block max-w-full whitespace-nowrap align-bottom leading-tight"
            >
                {children}
            </span>
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
                className="pointer-events-none absolute -right-12 -top-12 size-32 rounded-full opacity-[0.12] blur-2xl"
                style={{ backgroundColor: accent }}
            />
            <div className="flex items-start justify-between gap-2">
                <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                    {label}
                </div>
                {Icon && (
                    <Icon
                        className="size-4 shrink-0 opacity-70"
                        style={{ color: accent }}
                    />
                )}
            </div>
            <FitValue className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                {value}
            </FitValue>
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

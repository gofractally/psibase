import type { LucideIcon } from "lucide-react";

import { type ReactNode, useLayoutEffect, useRef } from "react";

import { cn } from "@shared/lib/utils";

interface StatCardProps {
    label: ReactNode;
    value: ReactNode;
    sub?: ReactNode;
    icon?: LucideIcon;
    accent?: string;
    className?: string;
    children?: ReactNode;
}

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
            {children}
        </div>
    );
};

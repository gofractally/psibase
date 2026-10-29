import { cn } from "@shared/lib/utils";

import { levelTone } from "../hooks/use-usage-credits";

const SEGMENTS = 20;

/** Segmented horizontal gauge for how full the usage-credit reserve is. */
export const UsageMeter = ({
    level,
    className,
    size = "md",
}: {
    level: number;
    className?: string;
    size?: "sm" | "md";
}) => {
    const clamped = Math.max(0, Math.min(100, level));
    const lit = Math.round((clamped / 100) * SEGMENTS);
    const tone = levelTone(clamped);
    return (
        <div
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clamped)}
            aria-label="Usage credits remaining"
            className={cn(
                "flex w-full gap-[3px]",
                size === "sm" ? "h-1.5" : "h-2.5",
                className,
            )}
        >
            {Array.from({ length: SEGMENTS }).map((_, i) => (
                <span
                    key={i}
                    className="bg-muted flex-1 rounded-[2px] transition-colors duration-500"
                    style={
                        i < lit
                            ? {
                                  backgroundColor: tone,
                                  boxShadow: `0 0 6px color-mix(in oklch, ${tone} 45%, transparent)`,
                              }
                            : undefined
                    }
                />
            ))}
        </div>
    );
};

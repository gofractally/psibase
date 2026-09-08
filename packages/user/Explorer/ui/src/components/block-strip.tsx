import { useNavigate } from "react-router-dom";

import type { BlockPoint } from "@/store/live-chain";
import { colorFor } from "@/lib/colors";
import { formatClock, formatNumber } from "@/lib/format";

import { cn } from "@shared/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

interface Props {
    series: BlockPoint[];
    count?: number;
    className?: string;
}

/**
 * The chain "heartbeat": one cell per recent block, colored by producer, with
 * a bar whose height reflects how many user transactions the block carried.
 */
export const BlockStrip = ({ series, count = 90, className }: Props) => {
    const navigate = useNavigate();
    const recent = series.slice(-count);
    const maxTx = Math.max(1, ...recent.map((p) => p.userTxs));
    return (
        <div
            className={cn(
                "flex h-14 items-end gap-[3px] overflow-hidden",
                className,
            )}
        >
            {recent.map((p) => {
                const h = 20 + (p.userTxs / maxTx) * 80;
                const slow = p.interval !== null && p.interval > 2;
                return (
                    <Tooltip key={p.blockNum}>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                onClick={() => navigate(`/blocks/${p.blockNum}`)}
                                className={cn(
                                    "block-cell flex-1 rounded-[2px] transition-[height,opacity] duration-300 hover:opacity-100",
                                    slow ? "opacity-40" : "opacity-85",
                                )}
                                style={{
                                    height: `${h}%`,
                                    backgroundColor:
                                        p.userTxs > 0
                                            ? colorFor(p.producer, 80, 60)
                                            : colorFor(p.producer, 30, 40),
                                    outline: slow
                                        ? "1px dashed var(--destructive)"
                                        : undefined,
                                }}
                                aria-label={`Block ${p.blockNum}`}
                            />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">
                            <div className="font-mono font-semibold">
                                #{formatNumber(p.blockNum)}
                            </div>
                            <div className="text-muted-foreground">
                                {formatClock(new Date(p.time))} · {p.producer}
                            </div>
                            <div>
                                {p.userTxs} tx · {p.actions} actions
                                {p.interval !== null &&
                                    ` · ${p.interval.toFixed(1)}s`}
                            </div>
                        </TooltipContent>
                    </Tooltip>
                );
            })}
        </div>
    );
};

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
 * The network "heartbeat": one cell per recent block, colored by provider, with
 * a bar whose height reflects how many transactions the block carried relative
 * to the quietest block in view. Every block carries system transactions, so
 * the quietest block is the baseline.
 */
export const BlockStrip = ({ series, count = 90, className }: Props) => {
    const navigate = useNavigate();
    const recent = series.slice(-count);
    const minTx = Math.min(...recent.map((p) => p.txs));
    const maxTx = Math.max(...recent.map((p) => p.txs));
    const range = Math.max(1, maxTx - minTx);
    return (
        <div
            className={cn(
                "flex h-14 items-end gap-[3px] overflow-hidden",
                className,
            )}
        >
            {recent.map((p) => {
                const h = 20 + ((p.txs - minTx) / range) * 80;
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
                                        p.txs > minTx
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
                                {p.txs} tx · {p.actions} actions
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

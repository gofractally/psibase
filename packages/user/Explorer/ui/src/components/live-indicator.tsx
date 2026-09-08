import { Link } from "react-router-dom";

import { formatNumber } from "@/lib/format";
import { useHead, useLiveStatus } from "@/store/use-live-chain";

import { cn } from "@shared/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

const STATUS: Record<
    string,
    { label: string; color: string; ring: string; pulse: boolean }
> = {
    connecting: {
        label: "Connecting",
        color: "bg-amber-400",
        ring: "bg-amber-400/40",
        pulse: true,
    },
    live: {
        label: "Live",
        color: "bg-emerald-500",
        ring: "bg-emerald-500/40",
        pulse: true,
    },
    stalled: {
        label: "No new blocks",
        color: "bg-amber-500",
        ring: "bg-amber-500/40",
        pulse: false,
    },
    error: {
        label: "Disconnected",
        color: "bg-rose-500",
        ring: "bg-rose-500/40",
        pulse: false,
    },
};

export const StatusDot = ({ className }: { className?: string }) => {
    const status = useLiveStatus();
    const s = STATUS[status];
    return (
        <span className={cn("relative inline-flex size-2.5", className)}>
            {s.pulse && (
                <span
                    className={cn(
                        "absolute inline-flex h-full w-full animate-ping rounded-full",
                        s.ring,
                    )}
                />
            )}
            <span
                className={cn(
                    "relative inline-flex size-2.5 rounded-full",
                    s.color,
                )}
            />
        </span>
    );
};

export const LiveIndicator = () => {
    const status = useLiveStatus();
    const head = useHead();
    const s = STATUS[status];
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Link
                    to={head ? `/blocks/${head.blockNum}` : "/blocks"}
                    className="bg-card/60 hover:bg-accent flex items-center gap-2.5 rounded-full border px-3 py-1.5 text-xs transition-colors"
                >
                    <StatusDot />
                    <span className="text-muted-foreground hidden sm:inline">
                        {s.label}
                    </span>
                    {head && (
                        <span className="font-mono tabular-nums">
                            #{formatNumber(head.blockNum)}
                        </span>
                    )}
                </Link>
            </TooltipTrigger>
            <TooltipContent>
                {head
                    ? `Head block ${formatNumber(head.blockNum)} · produced by ${head.producer}`
                    : "Waiting for blocks"}
            </TooltipContent>
        </Tooltip>
    );
};

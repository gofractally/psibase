import { formatAge, formatUtc, parseChainTime } from "@/lib/format";
import { useNow } from "@/store/use-live-chain";

import { cn } from "@shared/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

interface Props {
    time: string | number;
    className?: string;
    tooltip?: boolean;
}

export const TimeAgo = ({ time, className, tooltip = true }: Props) => {
    const now = useNow();
    const date = typeof time === "number" ? new Date(time) : parseChainTime(time);
    const label = formatAge(date, new Date(now));
    const inner = (
        <span className={cn("tabular-nums whitespace-nowrap", className)}>
            {label}
        </span>
    );
    if (!tooltip) return inner;
    return (
        <Tooltip>
            <TooltipTrigger asChild>{inner}</TooltipTrigger>
            <TooltipContent className="font-mono text-xs">
                {formatUtc(date)}
            </TooltipContent>
        </Tooltip>
    );
};

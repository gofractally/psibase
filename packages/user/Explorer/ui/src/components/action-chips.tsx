import { Link } from "react-router-dom";

import { colorFor } from "@/lib/colors";
import type { Action } from "@/lib/types";

import { cn } from "@shared/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

export const MethodChip = ({
    service,
    method,
    className,
}: {
    service: string;
    method: string;
    className?: string;
}) => (
    <span
        className={cn(
            "inline-flex items-center overflow-hidden rounded-md border font-mono text-[11px] leading-5",
            className,
        )}
    >
        <Link
            to={`/accounts/${service}`}
            className="hover:bg-accent px-1.5 transition-colors"
            style={{
                color: colorFor(service, 70, 65),
                borderRight: "1px solid var(--border)",
            }}
        >
            {service}
        </Link>
        <span className="text-foreground/80 bg-muted/40 px-1.5">{method}</span>
    </span>
);

export const ActionChips = ({
    actions,
    max = 3,
    className,
}: {
    actions: Action[];
    max?: number;
    className?: string;
}) => {
    const shown = actions.slice(0, max);
    const rest = actions.length - shown.length;
    return (
        <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
            {shown.map((a, i) => (
                <MethodChip key={i} service={a.service} method={a.method} />
            ))}
            {rest > 0 && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="text-muted-foreground bg-muted/40 rounded-md border px-1.5 font-mono text-[11px] leading-5">
                            +{rest}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">
                        <div className="flex flex-col gap-0.5 font-mono text-xs">
                            {actions.slice(max).map((a, i) => (
                                <span key={i}>
                                    {a.service}::{a.method}
                                </span>
                            ))}
                        </div>
                    </TooltipContent>
                </Tooltip>
            )}
        </span>
    );
};

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { shortHash } from "@/lib/format";

import { cn } from "@shared/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

interface HashProps {
    value: string;
    to?: string;
    head?: number;
    tail?: number;
    full?: boolean;
    copy?: boolean;
    className?: string;
}

export const CopyIcon = ({
    value,
    className,
}: {
    value: string;
    className?: string;
}) => {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            aria-label="Copy"
            className={cn(
                "text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center rounded p-0.5 transition-colors",
                className,
            )}
            onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(value);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                } catch {
                    /* ignore */
                }
            }}
        >
            {copied ? (
                <Check className="size-3.5 text-emerald-500" />
            ) : (
                <Copy className="size-3.5" />
            )}
        </button>
    );
};

export const Hash = ({
    value,
    to,
    head = 6,
    tail = 6,
    full = false,
    copy = true,
    className,
}: HashProps) => {
    const display = full ? value : shortHash(value, head, tail);
    const text = (
        <span
            className={cn(
                "font-mono text-[13px] tabular-nums tracking-tight",
                full && "break-all",
            )}
        >
            {display}
        </span>
    );
    const inner = to ? (
        <Link
            to={to}
            className="text-primary/90 hover:text-primary hover:underline"
        >
            {text}
        </Link>
    ) : (
        text
    );
    return (
        <span className={cn("inline-flex items-center gap-1", className)}>
            {full ? (
                inner
            ) : (
                <Tooltip>
                    <TooltipTrigger asChild>{inner}</TooltipTrigger>
                    <TooltipContent className="font-mono text-xs">
                        {value}
                    </TooltipContent>
                </Tooltip>
            )}
            {copy && <CopyIcon value={value} />}
        </span>
    );
};

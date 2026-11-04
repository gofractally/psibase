import type { ReactNode } from "react";

import { siblingUrl } from "@psibase/common-lib";
import { CircleHelp } from "lucide-react";

import { useDocsInstalled } from "@/hooks/use-docs-installed";
import type { DocPath } from "@/lib/docs";

import { cn } from "@shared/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

interface DocLinkProps {
    path: DocPath | string;
    /** Accessible name / tooltip subject, e.g. "TAPoS". */
    topic?: string;
    className?: string;
}

/** Small "?" that opens docs. Renders nothing unless Docs is installed. */
export const DocLink = ({ path, topic, className }: DocLinkProps) => {
    const installed = useDocsInstalled();
    if (!installed) return null;

    const label = topic ? `Learn about ${topic}` : "Open documentation";
    const href = siblingUrl(null, "docs", path);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                        "text-muted-foreground hover:text-foreground inline-flex shrink-0 rounded-sm transition-colors",
                        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                        className,
                    )}
                    aria-label={label}
                >
                    <CircleHelp className="size-3.5" />
                </a>
            </TooltipTrigger>
            <TooltipContent className="text-xs">{label}</TooltipContent>
        </Tooltip>
    );
};

/** Label text with an optional docs "?" beside it. */
export const DocLabel = ({
    children,
    path,
    topic,
    className,
}: {
    children: ReactNode;
    path: DocPath | string;
    topic?: string;
    className?: string;
}) => (
    <span className={cn("inline-flex items-center gap-1", className)}>
        {children}
        <DocLink path={path} topic={topic} />
    </span>
);

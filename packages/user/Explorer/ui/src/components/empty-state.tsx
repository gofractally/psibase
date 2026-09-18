import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@shared/lib/utils";

interface Props {
    children: ReactNode;
    icon?: LucideIcon;
    /** Secondary line, e.g. an error detail. */
    detail?: ReactNode;
    className?: string;
    style?: CSSProperties;
}

/**
 * Placeholder for a panel or list with nothing to show.
 *
 * It grows to fill whatever vertical space its parent gives it (panel bodies
 * are flex columns), so the message is centered in the *panel*, not in an
 * arbitrarily sized box. `min-h-32` keeps stand-alone panels from collapsing.
 */
export const EmptyState = ({
    children,
    icon: Icon,
    detail,
    className,
    style,
}: Props) => (
    <div
        className={cn(
            "text-muted-foreground flex min-h-32 flex-1 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center text-sm",
            className,
        )}
        style={style}
    >
        {Icon && <Icon className="size-4 opacity-60" aria-hidden />}
        <div className="max-w-md">{children}</div>
        {detail && (
            <div className="max-w-md break-all font-mono text-xs opacity-70">
                {detail}
            </div>
        )}
    </div>
);

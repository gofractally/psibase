import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@shared/lib/utils";

/**
 * Centered single-purpose card for standalone flows (invites, errors,
 * confirmations). Matches the splash-screen treatment.
 */
export const NoticeCard = ({
    icon: Icon,
    eyebrow,
    title,
    description,
    children,
    footer,
    tone = "default",
    className,
}: {
    icon?: LucideIcon;
    eyebrow?: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    children?: ReactNode;
    footer?: ReactNode;
    tone?: "default" | "warning" | "success";
    className?: string;
}) => (
    <div
        className={cn(
            "bg-card/70 mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border p-8 text-center shadow-sm backdrop-blur",
            className,
        )}
    >
        {Icon && (
            <div
                className={cn(
                    "flex size-12 items-center justify-center rounded-xl border [&_svg]:size-6",
                    tone === "warning" &&
                        "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                    tone === "success" &&
                        "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                    tone === "default" &&
                        "bg-primary/10 border-primary/20 text-primary",
                )}
            >
                <Icon />
            </div>
        )}
        <div className="flex flex-col gap-1">
            {eyebrow && (
                <div className="text-muted-foreground text-[11px] font-medium uppercase tracking-[0.2em]">
                    {eyebrow}
                </div>
            )}
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            {description && (
                <p className="text-muted-foreground text-sm">{description}</p>
            )}
        </div>
        {children}
        {footer && (
            <div className="flex w-full items-center justify-center gap-2">
                {footer}
            </div>
        )}
    </div>
);

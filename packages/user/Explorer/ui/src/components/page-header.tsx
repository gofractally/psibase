import type { ReactNode } from "react";

import { cn } from "@shared/lib/utils";

export const PageHeader = ({
    title,
    description,
    actions,
    className,
}: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    className?: string;
}) => (
    <div
        className={cn(
            "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
            className,
        )}
    >
        <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && (
                <p className="text-muted-foreground mt-1 text-sm">
                    {description}
                </p>
            )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
);

export const Panel = ({
    title,
    description,
    actions,
    children,
    className,
    bodyClassName,
}: {
    title?: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
    bodyClassName?: string;
}) => (
    <section
        className={cn(
            "bg-card/70 flex flex-col overflow-hidden rounded-xl border shadow-sm backdrop-blur",
            className,
        )}
    >
        {(title || actions) && (
            <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
                <div className="min-w-0">
                    {title && (
                        <h2 className="truncate text-sm font-semibold">
                            {title}
                        </h2>
                    )}
                    {description && (
                        <p className="text-muted-foreground truncate text-xs">
                            {description}
                        </p>
                    )}
                </div>
                {actions && (
                    <div className="flex shrink-0 items-center gap-2">
                        {actions}
                    </div>
                )}
            </header>
        )}
        <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
);

export const KeyValue = ({
    label,
    children,
    className,
}: {
    label: ReactNode;
    children: ReactNode;
    className?: string;
}) => (
    <div
        className={cn(
            "grid grid-cols-1 gap-1 border-b px-4 py-2.5 text-sm last:border-b-0 sm:grid-cols-[180px_1fr] sm:gap-4",
            className,
        )}
    >
        <div className="text-muted-foreground text-xs font-medium sm:pt-0.5">
            {label}
        </div>
        <div className="min-w-0 break-words">{children}</div>
    </div>
);

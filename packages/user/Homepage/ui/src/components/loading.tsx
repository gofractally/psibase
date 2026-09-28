import { LoaderCircle } from "lucide-react";

import { cn } from "@shared/lib/utils";

export const Loading = ({
    className,
    label,
}: {
    className?: string;
    label?: string;
}) => {
    return (
        <div
            className={cn(
                "text-muted-foreground flex h-full min-h-32 flex-1 select-none flex-col items-center justify-center gap-2 text-xs",
                className,
            )}
            role="status"
            aria-live="polite"
        >
            <LoaderCircle className="size-5 animate-spin opacity-70" />
            {label && <span>{label}</span>}
        </div>
    );
};

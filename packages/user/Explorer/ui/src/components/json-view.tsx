import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { CopyIcon } from "@/components/hash";

import { cn } from "@shared/lib/utils";

export const JsonView = ({
    value,
    title = "Raw JSON",
    defaultOpen = false,
    className,
}: {
    value: unknown;
    title?: string;
    defaultOpen?: boolean;
    className?: string;
}) => {
    const [open, setOpen] = useState(defaultOpen);
    const text = JSON.stringify(value, null, 2);
    return (
        <div className={cn("overflow-hidden rounded-lg border", className)}>
            <div className="bg-muted/30 flex items-center justify-between px-3 py-1.5">
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    className="flex items-center gap-1.5 text-xs font-medium"
                >
                    {open ? (
                        <ChevronDown className="size-3.5" />
                    ) : (
                        <ChevronRight className="size-3.5" />
                    )}
                    {title}
                </button>
                <CopyIcon value={text} />
            </div>
            {open && (
                <pre className="max-h-[480px] overflow-auto p-3 font-mono text-[11px] leading-relaxed">
                    {text}
                </pre>
            )}
        </div>
    );
};

import { Button } from "@shared/shadcn/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

export function AccountRowAction({
    tip,
    onClick,
    icon: Icon,
    label,
}: {
    tip: string;
    onClick: () => void;
    icon: React.ComponentType<{ className?: string }>;
    label?: string;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    size={label ? "sm" : "icon"}
                    variant="outline"
                    className={
                        label
                            ? "h-9 shrink-0 gap-1 px-2 text-xs sm:h-8"
                            : "size-9 shrink-0 sm:size-8"
                    }
                    aria-label={tip}
                    onClick={onClick}
                >
                    <Icon className="size-3.5" />
                    {label ? (
                        <span className="hidden sm:inline">{label}</span>
                    ) : null}
                </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
                {tip}
            </TooltipContent>
        </Tooltip>
    );
}

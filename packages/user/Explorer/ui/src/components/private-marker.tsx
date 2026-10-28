import { Lock } from "lucide-react";

import { cn } from "@shared/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@shared/shadcn/ui/tooltip";

export const PRIVATE_TRANSACTION_HINT =
    "Transaction contents are only visible to the accounts involved. Log in as one of them to see the actions.";

/** Stands in for the contents of a transaction the viewer is not a party to. */
export const PrivateMarker = ({
    label = "Private",
    className,
}: {
    label?: React.ReactNode;
    className?: string;
}) => (
    <Tooltip>
        <TooltipTrigger asChild>
            <span
                className={cn(
                    "text-muted-foreground inline-flex items-center gap-1 text-xs",
                    className,
                )}
            >
                <Lock className="size-3" />
                {label}
            </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
            {PRIVATE_TRANSACTION_HINT}
        </TooltipContent>
    </Tooltip>
);

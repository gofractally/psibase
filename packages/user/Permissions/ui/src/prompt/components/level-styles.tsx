import type { TrustLevel } from "../types";

import { AlertCircleIcon, InfoIcon } from "lucide-react";
import { type ComponentProps } from "react";

import { Alert } from "@shared/shadcn/ui/alert";
import { Badge } from "@shared/shadcn/ui/badge";

export const levelStyles: Record<
    TrustLevel,
    {
        badgeVariant: ComponentProps<typeof Badge>["variant"];
        badgeClassName?: string;
        alertVariant: ComponentProps<typeof Alert>["variant"];
        icon: React.ReactNode;
    }
> = {
    low: {
        badgeVariant: "secondary",
        badgeClassName: "bg-blue-500 text-white dark:bg-blue-600",
        alertVariant: "default",
        icon: <InfoIcon />,
    },
    medium: {
        badgeVariant: "default",
        alertVariant: "default",
        icon: <InfoIcon />,
    },
    high: {
        badgeVariant: "destructive",
        alertVariant: "destructive",
        icon: <AlertCircleIcon />,
    },
};

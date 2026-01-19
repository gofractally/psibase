import type { TrustLevel } from "../types";

import { InfoIcon, TriangleAlertIcon } from "lucide-react";
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
        requestedLevels: TrustLevel[];
        descriptionIndex: 0 | 1 | 2;
    }
> = {
    low: {
        badgeVariant: "secondary",
        badgeClassName: "bg-blue-500 text-white dark:bg-blue-600",
        alertVariant: "default",
        icon: <InfoIcon />,
        requestedLevels: ["low"],
        descriptionIndex: 0,
    },
    medium: {
        badgeVariant: "default",
        alertVariant: "default",
        icon: <InfoIcon />,
        requestedLevels: ["medium", "low"],
        descriptionIndex: 1,
    },
    high: {
        badgeVariant: "destructive",
        alertVariant: "destructive",
        icon: <TriangleAlertIcon />,
        requestedLevels: ["high", "medium", "low"],
        descriptionIndex: 2,
    },
};

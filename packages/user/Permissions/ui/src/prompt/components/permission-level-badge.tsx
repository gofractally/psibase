import type { TrustLevel } from "../types";

import { Badge } from "@shared/shadcn/ui/badge";

import { levelStyles } from "./level-styles";

export const LevelBadge = ({ level }: { level: TrustLevel }) => {
    return (
        <Badge
            variant={levelStyles[level].badgeVariant}
            className={levelStyles[level].badgeClassName}
        >
            {level}
        </Badge>
    );
};

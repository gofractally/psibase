import { CardContent } from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

import { PortalCard } from "./portal-card";

export const Loader = () => (
    <PortalCard>
        <CardContent className="flex flex-col">
            <Skeleton className="mb-6 h-8 w-[280px]" />
            <div className="space-y-2">
                <Skeleton className="h-4 w-full max-w-[400px]" />
                <Skeleton className="h-4 w-full max-w-[350px]" />
            </div>
            <Skeleton className="mt-6 h-10 w-full" />
        </CardContent>
    </PortalCard>
);

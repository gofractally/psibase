import {
    Card,
    CardAction,
    CardContent,
    CardHeader,
} from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export function NameMarketCardSkeleton() {
    return (
        <Card className="gap-0 py-0 shadow-sm">
            <CardHeader className="border-b px-4 py-3">
                <Skeleton className="h-5 w-20" />
                <CardAction>
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-3 w-12" />
                        <Skeleton className="h-5 w-9 rounded-full" />
                    </div>
                </CardAction>
            </CardHeader>
            <CardContent className="px-4 py-3">
                <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {Array.from({ length: 5 }).map((_, index) => (
                        <div key={index} className="grid gap-1">
                            <Skeleton className="h-3 w-16" />
                            <Skeleton className="h-8 w-full" />
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

export function NameMarketCardsSkeleton({ count }: { count: number }) {
    return (
        <div className="space-y-4">
            {Array.from({ length: count }).map((_, index) => (
                <NameMarketCardSkeleton key={index} />
            ))}
        </div>
    );
}

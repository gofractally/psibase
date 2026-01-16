import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { CardContent, CardFooter, CardHeader } from "@shared/shadcn/ui/card";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const LoadingSkeleton = () => {
    return (
        <BrandedGlowingCard>
            <CardHeader>
                <Skeleton className="h-9 w-64" />
                <div className="space-y-2 pt-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                </div>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <div className="flex gap-2">
                        <Skeleton className="h-9 w-20 rounded-lg" />
                        <Skeleton className="h-9 w-24 rounded-lg" />
                        <Skeleton className="h-9 w-20 rounded-lg" />
                    </div>
                    <Skeleton className="h-24 w-full rounded-lg" />
                </div>

                <div className="space-y-3">
                    <Skeleton className="h-5 w-24" />
                    <div className="space-y-3">
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-4 w-4 rounded-full" />
                            <Skeleton className="h-4 w-32" />
                        </div>
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-4 w-4 rounded-full" />
                            <Skeleton className="h-4 w-56" />
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                </div>
            </CardContent>
            <CardFooter className="flex justify-center gap-4">
                <Skeleton className="h-10 w-24" />
                <Skeleton className="h-10 w-24" />
            </CardFooter>
        </BrandedGlowingCard>
    );
};

import { BrandedGlowingCard } from "@shared/components/branded-glowing-card";
import { CardContent } from "@shared/shadcn/ui/card";
import { Progress } from "@shared/shadcn/ui/progress";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const Loader = () => {
    return (
        <BrandedGlowingCard>
            <div className="-mt-6 px-6">
                <Progress value={33} />
            </div>
            <CardContent className="flex flex-col">
                <Skeleton className="mb-6 h-8 w-[280px]" />
                <div className="space-y-2">
                    <Skeleton className="h-4 w-full max-w-[400px]" />
                    <Skeleton className="h-4 w-full max-w-[350px]" />
                </div>
                <Skeleton className="mt-6 h-10 w-full" />
            </CardContent>
        </BrandedGlowingCard>
    );
};

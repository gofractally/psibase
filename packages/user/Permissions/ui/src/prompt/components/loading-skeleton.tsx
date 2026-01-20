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
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-5 w-40" />
                        <div className="flex gap-1">
                            <Skeleton className="h-5 w-12 rounded-full" />
                            <Skeleton className="h-5 w-16 rounded-full" />
                        </div>
                    </div>
                    {/* Alert skeletons */}
                    <div className="space-y-3">
                        {/* First Alert */}
                        <div className="rounded-lg border p-4">
                            <div className="grid grid-cols-[auto_1fr] gap-3">
                                <Skeleton className="h-4 w-4" />
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Skeleton className="h-5 w-12 rounded-full" />
                                        <Skeleton className="h-4 w-48" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Skeleton className="h-4 w-full" />
                                        <Skeleton className="h-4 w-5/6" />
                                        <Skeleton className="h-4 w-4/5" />
                                    </div>
                                </div>
                            </div>
                        </div>
                        {/* Second Alert */}
                        <div className="rounded-lg border p-4">
                            <div className="grid grid-cols-[auto_1fr] gap-3">
                                <Skeleton className="h-4 w-4" />
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Skeleton className="h-5 w-12 rounded-full" />
                                        <Skeleton className="h-4 w-48" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Skeleton className="h-4 w-full" />
                                        <Skeleton className="h-4 w-4/5" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
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
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-24" />
            </CardFooter>
        </BrandedGlowingCard>
    );
};

import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const UserProfileSkeleton = () => {
    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-4 w-full max-w-md" />
            </div>
            <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-4 w-full max-w-md" />
            </div>
            <Skeleton className="h-10 w-32" />
        </div>
    );
};

import { PageContainer } from "@shared/components/page-container";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const Loader = () => (
    <PageContainer className="space-y-6">
        <Skeleton className="h-8 w-[280px]" />
        <div className="space-y-2">
            <Skeleton className="h-4 w-full max-w-[400px]" />
            <Skeleton className="h-4 w-full max-w-[350px]" />
        </div>
        <Skeleton className="h-10 w-full" />
    </PageContainer>
);

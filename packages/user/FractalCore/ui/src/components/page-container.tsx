import { cn } from "@shared/lib/utils";

export const PageContainer = ({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) => {
    return (
        <div className={cn("mx-auto w-full max-w-5xl p-4 px-6", className)}>
            {children}
        </div>
    );
};

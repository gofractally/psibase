import { Command } from "lucide-react";

import { useBranding } from "@shared/hooks/use-branding";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface Props {
    onClick?: () => void;
}

export const NetworkLogo = ({ onClick }: Props) => {
    const { data: networkName, isLoading } = useBranding();

    return (
        <div role="button" onClick={onClick} className="flex cursor-pointer">
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <Command className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
                {isLoading ? (
                    <Skeleton className="h-4 w-[100px]" />
                ) : (
                    <span className="truncate font-semibold">
                        {networkName}
                    </span>
                )}
            </div>
        </div>
    );
};

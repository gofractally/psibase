import { useChainId } from "@shared/hooks/use-chain-id";
import { createIdenticon } from "@shared/lib/create-identicon";
import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface Props {
    name?: string;
    account?: string;
    size?: "sm" | "default";
    className?: string;
}

const isSm = (size: Props["size"]) => size === "sm";

export const FractalGuildIdentifier = ({
    name,
    account,
    size = "default",
    className,
}: Props) => {
    const { data: chainId, isPending, isError } = useChainId();
    const sm = isSm(size);

    if (isError) {
        return null;
    }

    if (isPending || !name || !account) {
        return (
            <div className={cn("flex items-center gap-2", sm && "gap-1.5", className)}>
                <Skeleton
                    className={cn(
                        "shrink-0 rounded-lg",
                        sm ? "size-9" : "size-12",
                    )}
                />
                <div className={cn("flex flex-1 flex-col", sm ? "gap-1.5" : "gap-2")}>
                    <Skeleton className={sm ? "h-5 w-24" : "h-6 w-32"} />
                    <Skeleton className={sm ? "h-3 w-20" : "h-4 w-24"} />
                </div>
            </div>
        );
    }

    return (
        <div className={cn("flex items-center gap-2", sm && "gap-1.5", className)}>
            <div
                className={cn(
                    "bg-background text-sidebar-primary-foreground flex aspect-square items-center justify-center rounded-lg border",
                    sm ? "size-9" : "size-12",
                )}
            >
                <img
                    src={createIdenticon(chainId + account)}
                    alt={`${name} identicon`}
                    className="size-3/5"
                />
            </div>
            <div className="flex-1">
                <div
                    className={cn(
                        "font-semibold leading-tight",
                        sm ? "text-base" : "text-xl",
                    )}
                >
                    {name}
                </div>
                <div
                    className={cn(
                        "text-muted-foreground font-normal leading-tight",
                        sm ? "text-xs" : "text-sm",
                    )}
                >
                    {account}
                </div>
            </div>
        </div>
    );
};

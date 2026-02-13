import { useChainId } from "@shared/hooks/use-chain-id";
import { createIdenticon } from "@shared/lib/create-identicon";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface Props {
    name?: string;
    account?: string;
}

export const FractalGuildHeaderIdentifier = ({ name, account }: Props) => {
    const { data: chainId, isPending, isError } = useChainId();

    if (isError) {
        return null;
    }

    if (isPending || !name || !account) {
        return (
            <div className="flex items-center gap-2">
                <Skeleton className="size-12 shrink-0 rounded-lg" />
                <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-4 w-24" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <div className="bg-background text-sidebar-primary-foreground flex aspect-square size-12 items-center justify-center rounded-lg border">
                <img
                    src={createIdenticon(chainId + account)}
                    alt={`${name} identicon`}
                    className="size-3/5"
                />
            </div>
            <div className="flex-1">
                <div className="text-xl font-semibold leading-tight">
                    {name}
                </div>
                <div className="text-muted-foreground text-sm font-normal leading-tight">
                    {account}
                </div>
            </div>
        </div>
    );
};

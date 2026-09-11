import { Avatar } from "@shared/components/avatar";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

export const TableContact = ({
    account,
    nickname,
    isLoading = false,
    isError = false,
}: {
    account: string;
    nickname?: string | null;
    isLoading?: boolean;
    isError?: boolean;
}) => {
    if (isLoading) {
        return (
            <div className="@lg:h-auto flex h-10 items-center gap-2">
                <Skeleton className="@lg:h-5 @lg:w-5 h-8 w-8 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-24" />
            </div>
        );
    }

    if (isError) {
        return <div>{account}</div>;
    }

    return (
        <div className="@lg:h-auto flex h-10 items-center gap-2">
            <Avatar
                account={account}
                className="@lg:h-5 @lg:w-5 h-8 w-8"
                alt="Contact avatar"
            />
            {nickname ? (
                <div className="@lg:flex-row @lg:gap-1 flex flex-col">
                    <div className="font-medium">{nickname}</div>
                    <div className="text-muted-foreground italic">
                        {account}
                    </div>
                </div>
            ) : (
                <div className="italic">{account}</div>
            )}
        </div>
    );
};

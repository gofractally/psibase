import { useAvatar } from "@shared/hooks/use-avatar";
import { AvatarType } from "@shared/lib/create-identicon";
import { cn } from "@shared/lib/utils";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

interface Props extends React.ComponentProps<"img"> {
    account: string | null;
    type?: AvatarType;
}

export const Avatar = ({ account, type, ...props }: Props) => {
    const { avatarSrc, isLoading } = useAvatar({ account, type });

    if (isLoading) {
        return (
            <Skeleton className={cn("size-6 rounded-full", props.className)} />
        );
    }

    return (
        <img
            src={avatarSrc}
            {...props}
            className={cn(
                "aspect-square rounded-full border-2 border-white object-cover shadow-sm dark:border-slate-700",
                props.className,
            )}
        />
    );
};

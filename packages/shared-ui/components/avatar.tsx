import { useAvatar } from "@shared/hooks/use-avatar";
import { AvatarType } from "@shared/lib/create-identicon";
import { cn } from "@shared/lib/utils";

interface Props extends React.ComponentProps<"img"> {
    account: string;
    type?: AvatarType;
}

export const Avatar = ({ account, type, ...props }: Props) => {
    const { avatarSrc } = useAvatar({ account, type });

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

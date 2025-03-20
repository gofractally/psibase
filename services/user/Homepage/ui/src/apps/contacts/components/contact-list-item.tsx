import { AvatarImage } from "@/components/ui/avatar";
import { Avatar } from "@/components/ui/avatar";

import { useAvatar } from "@/hooks/use-avatar";
import { useProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";

import { LocalContact } from "../types";
import { formatNames } from "../utils/formatNames";

export const ContactItem = ({
    contact,
    isSelected,
    onSelect,
}: {
    contact: LocalContact;
    isSelected: boolean;
    onSelect: () => void;
}) => {
    const { data: profile } = useProfile(contact.account);
    const avatarSrc = useAvatar(contact.account);

    const [primaryName, secondaryName] = formatNames(
        contact.nickname,
        profile?.profile?.displayName,
        contact.account,
    );

    return (
        <div
            onClick={onSelect}
            className={cn(
                "flex w-full cursor-pointer justify-between rounded-sm border p-4",
                {
                    "bg-muted": isSelected,
                },
            )}
        >
            <div className="flex items-center gap-2">
                <Avatar className={cn("rounded-none")}>
                    <AvatarImage src={avatarSrc} className="object-cover" />
                </Avatar>
                <div className="flex flex-col">
                    <p className="text-md font-medium">{primaryName}</p>
                </div>
            </div>

            {secondaryName && (
                <div className="flex flex-col justify-center">
                    <div>
                        <p className="text-right text-sm text-muted-foreground">
                            {secondaryName}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

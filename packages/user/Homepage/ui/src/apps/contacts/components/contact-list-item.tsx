import { useProfile } from "@/hooks/use-profile";

import { Avatar } from "@shared/components/avatar";
import { cn } from "@shared/lib/utils";

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
                <Avatar account={contact.account} className="w-8" />
                <div className="flex flex-col">
                    <p className="text-md font-medium">{primaryName}</p>
                </div>
            </div>

            {secondaryName && (
                <div className="flex flex-col justify-center">
                    <div>
                        <p className="text-muted-foreground text-right text-sm">
                            {secondaryName}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

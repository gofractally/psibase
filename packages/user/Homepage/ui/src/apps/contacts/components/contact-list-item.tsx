import { Avatar } from "@shared/components/avatar";
import { useProfile } from "@shared/hooks/use-profile";
import { cn } from "@shared/lib/utils";

import { LocalContact } from "../types";
import { formatNames } from "../utils/format-names";

export const ContactItem = ({
    contact,
    isSelected,
    onSelect,
}: {
    contact: LocalContact;
    isSelected: boolean;
    onSelect: () => void;
}) => {
    const { data: profile } = useProfile(contact.account, true, {});

    const [primaryName, secondaryName] = formatNames(
        contact.nickname,
        profile?.profile?.displayName,
        contact.account,
    );

    return (
        <li>
            <button
                type="button"
                onClick={onSelect}
                aria-pressed={isSelected}
                className={cn(
                    "hover:bg-accent/40 focus-visible:ring-ring relative flex w-full items-center gap-3 px-4 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset",
                    isSelected && "bg-accent/60",
                )}
            >
                {isSelected && (
                    <span
                        aria-hidden
                        className="bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-r"
                    />
                )}
                <Avatar
                    account={contact.account}
                    className="size-8 shrink-0"
                    alt=""
                />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span
                        className={cn(
                            "truncate text-[13px] font-medium",
                            !secondaryName && "font-mono",
                        )}
                    >
                        {primaryName}
                    </span>
                    {secondaryName && (
                        <span className="text-muted-foreground truncate font-mono text-[11px]">
                            {secondaryName}
                        </span>
                    )}
                </span>
            </button>
        </li>
    );
};

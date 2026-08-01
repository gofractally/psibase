import type { LocalContact } from "@shared/hooks/use-contacts";

import { formatNames } from "@/apps/contacts/utils/format-names";

import { Avatar } from "@shared/components/avatar";
import { useProfile } from "@shared/hooks/use-profile";
import { cn } from "@shared/lib/utils";

import type { PresenceUi } from "../hooks/use-realtime-presence";

export const PresenceDot = ({ status }: { status: PresenceUi }) => {
    const color =
        status === "online"
            ? "bg-emerald-500"
            : status === "offline"
              ? "bg-muted-foreground/40"
              : "bg-muted-foreground/25";
    const title =
        status === "online"
            ? "Online"
            : status === "offline"
              ? "Offline"
              : "Unknown";

    return (
        <span
            className={cn("inline-block size-2 shrink-0 rounded-full", color)}
            title={title}
        />
    );
};

export const ContactWithPresenceRow = ({
    contact,
    presence,
}: {
    contact: LocalContact;
    presence: PresenceUi;
}) => {
    const { data: profile } = useProfile(contact.account, true, {});
    const [primaryName] = formatNames(
        contact.nickname,
        profile?.profile?.displayName,
        contact.account,
    );

    return (
        <div className="flex w-full items-center justify-between gap-2 rounded-sm px-3 py-1.5 hover:bg-muted/60">
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <Avatar account={contact.account} className="size-8 shrink-0" />
                <span className="truncate text-[14px] font-medium leading-snug">
                    {primaryName}
                </span>
            </div>
            <PresenceDot status={presence} />
        </div>
    );
};

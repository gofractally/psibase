import type { LocalContact } from "@/apps/chat/contacts/types";
import type { PresenceUi } from "@/apps/chat/hooks/use-chat-socket";

import { ChevronDown, ChevronRight } from "lucide-react";

import { formatNames } from "@/apps/chat/contacts/utils/format-names";

import { Avatar } from "@shared/components/avatar";
import { useProfile } from "@shared/hooks/use-profile";
import { cn } from "@shared/lib/utils";
import { Checkbox } from "@shared/shadcn/ui/checkbox";

/**
 * Small presentational pieces for `ChatPage`'s contacts sidebar section:
 * the collapsible section header, a presence indicator dot, and a single
 * contact row (either a plain DM-open button or a group-pick checkbox row).
 */

export const SectionToggle = ({
    children,
    expanded,
    onToggle,
}: {
    children: React.ReactNode;
    expanded: boolean;
    onToggle: () => void;
}) => (
    <button
        type="button"
        onClick={onToggle}
        className="text-muted-foreground flex w-full items-center gap-1 px-4 pb-1 pt-3 text-left text-xs font-semibold uppercase tracking-wide hover:text-foreground"
        aria-expanded={expanded}
    >
        {expanded ? (
            <ChevronDown className="size-3.5" aria-hidden />
        ) : (
            <ChevronRight className="size-3.5" aria-hidden />
        )}
        {children}
    </button>
);

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
    isSelected,
    onSelect,
    presence,
    groupPickMode,
    groupSelected,
    setGroupIncluded,
}: {
    contact: LocalContact;
    isSelected: boolean;
    onSelect: () => void;
    presence: PresenceUi;
    groupPickMode: boolean;
    groupSelected: boolean;
    setGroupIncluded: (included: boolean) => void;
}) => {
    const { data: profile } = useProfile(contact.account, true, {});
    const [primaryName] = formatNames(
        contact.nickname,
        profile?.profile?.displayName,
        contact.account,
    );

    return (
        <div
            className={cn(
                "flex w-full items-center justify-between gap-2 rounded-sm px-3 py-1.5",
                isSelected && !groupPickMode ? "bg-muted" : "hover:bg-muted/60",
            )}
        >
            {groupPickMode ? (
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <Checkbox
                        checked={groupSelected}
                        onCheckedChange={(v) => {
                            if (v === "indeterminate") return;
                            setGroupIncluded(v);
                        }}
                        aria-label={`Include ${primaryName} in group`}
                    />
                    <Avatar
                        account={contact.account}
                        className="size-8 shrink-0"
                    />
                    <span className="truncate text-[14px] font-medium leading-snug">
                        {primaryName}
                    </span>
                </label>
            ) : (
                <button
                    type="button"
                    onClick={onSelect}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                    <Avatar
                        account={contact.account}
                        className="size-8 shrink-0"
                    />
                    <span className="truncate text-[14px] font-medium leading-snug">
                        {primaryName}
                    </span>
                </button>
            )}
            <PresenceDot status={presence} />
        </div>
    );
};

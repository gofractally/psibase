import { Avatar } from "@shared/components/avatar";
import { cn } from "@shared/lib/utils";

import type { ConversationSnapshot } from "../lib/protocol";

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <div className="text-muted-foreground px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide">
        {children}
    </div>
);

export function formatConversationSubtitle(
    conv: ConversationSnapshot,
    selfAccount: string | undefined,
): string {
    const others = conv.members.filter((m) => m !== selfAccount);
    if (conv.kind === "dm") return others[0] ?? "(unknown)";
    return others.join(", ");
}

type Props = {
    conversations: ConversationSnapshot[];
    selfAccount: string | null;
    selectedConversationId?: string;
    onSelectConversation: (id: string) => void;
};

export function ConversationList({
    conversations,
    selfAccount,
    selectedConversationId,
    onSelectConversation,
}: Props) {
    const dms = conversations.filter((c) => c.kind === "dm");
    const groups = conversations.filter((c) => c.kind === "group");
    const self = selfAccount ?? "";

    const Row = ({
        conv,
        avatarAccount,
        title,
        subtitle,
    }: {
        conv: ConversationSnapshot;
        avatarAccount: string | null;
        title: string;
        subtitle?: string;
    }) => (
        <button
            type="button"
            onClick={() => onSelectConversation(conv.conversationId)}
            className={cn(
                "flex w-full items-center gap-2 rounded-sm border px-3 py-2 text-left hover:bg-muted/60",
                selectedConversationId === conv.conversationId && "bg-muted",
            )}
        >
            <Avatar
                account={avatarAccount}
                className="size-8 shrink-0"
            />
            <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{title}</p>
                {subtitle ? (
                    <p className="text-muted-foreground truncate text-xs">
                        {subtitle}
                    </p>
                ) : null}
            </div>
        </button>
    );

    return (
        <div className="w-full">
            <SectionTitle>Direct Messages</SectionTitle>
            <div className="flex flex-col gap-1 px-4 pb-2">
                {dms.length === 0 ? (
                    <p className="text-muted-foreground px-1 py-2 text-sm">
                        No DM threads yet — open one from Contacts.
                    </p>
                ) : (
                    dms.map((c) => {
                        const other =
                            c.members.find((m) => m !== self) ?? c.members[0];
                        const subtitle = formatConversationSubtitle(
                            c,
                            self || undefined,
                        );
                        return (
                            <Row
                                key={c.conversationId}
                                conv={c}
                                avatarAccount={other ?? subtitle}
                                title={other ?? subtitle}
                                subtitle={undefined}
                            />
                        );
                    })
                )}
            </div>

            <SectionTitle>Group Chats</SectionTitle>
            <div className="flex flex-col gap-1 px-4 pb-6">
                {groups.length === 0 ? (
                    <p className="text-muted-foreground px-1 py-2 text-sm">
                        No groups yet. Select at least two others under Contacts
                        to start a participant-set chat.
                    </p>
                ) : (
                    groups.map((c) => {
                        const others = c.members.filter((m) => m !== self);
                        const avatarAccount = others[0] ?? c.members[0] ?? null;
                        return (
                            <Row
                                key={c.conversationId}
                                conv={c}
                                avatarAccount={avatarAccount}
                                title={`Group (${c.members.length})`}
                                subtitle={formatConversationSubtitle(
                                    c,
                                    self || undefined,
                                )}
                            />
                        );
                    })
                )}
            </div>
        </div>
    );
}

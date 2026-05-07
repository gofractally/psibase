import { useEffect, useRef, useState } from "react";

import { Avatar } from "@shared/components/avatar";
import { cn } from "@shared/lib/utils";

import type { ConversationSnapshot } from "../lib/protocol";

export const MAX_VISIBLE_DM_ITEMS = 15;
const CONVERSATION_ROW_HEIGHT_PX = 44;
const GROUP_LABEL_MIN_PREFIX = 2;

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

export function formatGroupConversationLabel(
    conv: ConversationSnapshot,
    selfAccount: string | undefined,
    maxChars: number,
): string {
    const others = conv.members.filter((m) => m !== selfAccount);
    if (others.length === 0) return "Group";
    const full = others.join(", ");
    if (full.length <= maxChars) return full;

    const suffix = "...";
    const usable = Math.max(maxChars - suffix.length, 0);
    for (
        let prefixLen = Math.max(...others.map((m) => m.length));
        prefixLen >= GROUP_LABEL_MIN_PREFIX;
        prefixLen--
    ) {
        const candidate = others
            .map((member) => member.slice(0, Math.min(prefixLen, member.length)))
            .join(", ");
        if (candidate.length <= usable) return `${candidate}${suffix}`;
    }

    return `${others
        .map((member) => member.slice(0, GROUP_LABEL_MIN_PREFIX))
        .join(", ")}${suffix}`;
}

type Props = {
    conversations: ConversationSnapshot[];
    selfAccount: string | null;
    selectedConversationId?: string;
    onSelectConversation: (id: string) => void;
    undeliveredByConversation?: Record<string, number>;
    unreadByConversation?: Record<string, number>;
};

export function ConversationList({
    conversations,
    selfAccount,
    selectedConversationId,
    onSelectConversation,
    undeliveredByConversation = {},
    unreadByConversation = {},
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [rowWidth, setRowWidth] = useState(260);
    const dms = conversations.filter((c) => c.kind === "dm");
    const groups = conversations.filter((c) => c.kind === "group");
    const self = selfAccount ?? "";
    const groupMaxChars = Math.max(12, Math.floor((rowWidth - 104) / 7));

    useEffect(() => {
        const node = containerRef.current;
        if (!node) return;
        const update = () => setRowWidth(node.clientWidth || 260);
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const Row = ({
        conv,
        avatarAccount,
        title,
        subtitle,
        fullTitle,
    }: {
        conv: ConversationSnapshot;
        avatarAccount: string | null;
        title: string;
        subtitle?: string;
        fullTitle?: string;
    }) => (
        <button
            type="button"
            onClick={() => onSelectConversation(conv.conversationId)}
            title={fullTitle ?? title}
            aria-label={`${fullTitle ?? title}${
                unreadByConversation[conv.conversationId]
                    ? `, ${unreadByConversation[conv.conversationId]} new messages`
                    : ""
            }${
                undeliveredByConversation[conv.conversationId]
                    ? `, ${undeliveredByConversation[conv.conversationId]} undelivered`
                    : ""
            }`}
            className={cn(
                "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left hover:bg-muted/60",
                selectedConversationId === conv.conversationId && "bg-muted",
            )}
        >
            <Avatar
                account={avatarAccount}
                className="size-7 shrink-0"
            />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{title}</p>
                {subtitle ? (
                    <p className="text-muted-foreground truncate text-xs">
                        {subtitle}
                    </p>
                ) : null}
            </div>
            {undeliveredByConversation[conv.conversationId] ? (
                <span
                    className="bg-amber-500/15 text-amber-700 inline-flex min-w-5 shrink-0 justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold dark:text-amber-300"
                    title={`${undeliveredByConversation[conv.conversationId]} undelivered recipients`}
                >
                    !
                </span>
            ) : null}
            {unreadByConversation[conv.conversationId] ? (
                <span
                    className="bg-primary text-primary-foreground inline-flex min-w-5 shrink-0 justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                    title={`${unreadByConversation[conv.conversationId]} new messages`}
                >
                    {unreadByConversation[conv.conversationId]}
                </span>
            ) : null}
        </button>
    );

    return (
        <div ref={containerRef} className="w-full">
            <SectionTitle>Direct Messages</SectionTitle>
            <div
                className="flex flex-col gap-1 overflow-y-auto px-4 pb-2"
                style={{
                    maxHeight: `${MAX_VISIBLE_DM_ITEMS * CONVERSATION_ROW_HEIGHT_PX}px`,
                }}
            >
                {dms.length === 0 ? (
                    <p className="text-muted-foreground px-1 py-2 text-sm">
                        No DM threads yet - open one from Contacts.
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
                        const fullTitle = formatConversationSubtitle(
                            c,
                            self || undefined,
                        );
                        const title = formatGroupConversationLabel(
                            c,
                            self || undefined,
                            groupMaxChars,
                        );
                        return (
                            <Row
                                key={c.conversationId}
                                conv={c}
                                avatarAccount={avatarAccount}
                                title={title}
                                subtitle={undefined}
                                fullTitle={fullTitle}
                            />
                        );
                    })
                )}
            </div>
        </div>
    );
}

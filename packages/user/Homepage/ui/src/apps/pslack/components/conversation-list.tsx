import type { PresenceUi } from "../hooks/use-pslack-socket";
import type { ConversationSnapshot } from "../lib/protocol";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Avatar } from "@shared/components/avatar";
import { cn } from "@shared/lib/utils";

export const MAX_VISIBLE_DM_ITEMS = 15;
const CONVERSATION_ROW_HEIGHT_PX = 44;
const GROUP_LABEL_MIN_PREFIX = 2;

const SectionToggle = ({
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
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-4 pb-1 pt-3 text-left text-xs font-semibold uppercase tracking-wide"
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

function PresenceDot({ status }: { status: PresenceUi }) {
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
}

/** Fallback is account string when no nickname / resolver omitted. */
export function formatConversationSubtitle(
    conv: ConversationSnapshot,
    selfAccount: string | undefined,
    resolveGroupMemberLabel?: (account: string) => string,
): string {
    const others = conv.members.filter((m) => m !== selfAccount);
    if (conv.kind === "dm") {
        const raw = others[0] ?? "(unknown)";
        if (raw === "(unknown)") return raw;
        const label = resolveGroupMemberLabel ?? ((a: string) => a);
        return label(raw);
    }
    const label = resolveGroupMemberLabel ?? ((a: string) => a);
    return others.map(label).join(", ");
}

export function formatGroupConversationLabel(
    conv: ConversationSnapshot,
    selfAccount: string | undefined,
    maxChars: number,
    resolveGroupMemberLabel?: (account: string) => string,
): string {
    const others = conv.members.filter((m) => m !== selfAccount);
    const label = resolveGroupMemberLabel ?? ((a: string) => a);
    const labels = others.map(label);
    if (labels.length === 0) return "Group";
    const full = labels.join(", ");
    if (full.length <= maxChars) return full;

    const suffix = "...";
    const usable = Math.max(maxChars - suffix.length, 0);
    for (
        let prefixLen = Math.max(...labels.map((m) => m.length));
        prefixLen >= GROUP_LABEL_MIN_PREFIX;
        prefixLen--
    ) {
        const candidate = labels
            .map((member) =>
                member.slice(0, Math.min(prefixLen, member.length)),
            )
            .join(", ");
        if (candidate.length <= usable) return `${candidate}${suffix}`;
    }

    return `${labels
        .map((member) => member.slice(0, GROUP_LABEL_MIN_PREFIX))
        .join(", ")}${suffix}`;
}

/** Tooltip / aria: nicknames with account in parentheses when they differ. */
export function formatGroupConversationFullTitle(
    conv: ConversationSnapshot,
    selfAccount: string | undefined,
    resolveGroupMemberLabel?: (account: string) => string,
): string {
    const others = conv.members.filter((m) => m !== selfAccount);
    const label = resolveGroupMemberLabel ?? ((a: string) => a);
    return others
        .map((account) => {
            const nick = label(account);
            return nick !== account ? `${nick} (${account})` : account;
        })
        .join(", ");
}

type Props = {
    conversations: ConversationSnapshot[];
    selfAccount: string | null;
    selectedConversationId?: string;
    onSelectConversation: (id: string) => void;
    undeliveredByConversation?: Record<string, number>;
    unreadByConversation?: Record<string, number>;
    groupActions?: React.ReactNode;
    /** Prefer contact nicknames for DM/group titles (falls back to account). */
    resolveGroupMemberLabel?: (account: string) => string;
    presenceByAccount?: Record<string, PresenceUi>;
    /** When true, shows hint under Group Chats header (above action buttons). */
    groupPickMode?: boolean;
};

export function ConversationList({
    conversations,
    selfAccount,
    selectedConversationId,
    onSelectConversation,
    undeliveredByConversation = {},
    unreadByConversation = {},
    groupActions,
    resolveGroupMemberLabel,
    presenceByAccount,
    groupPickMode = false,
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [rowWidth, setRowWidth] = useState(260);
    const [dmsExpanded, setDmsExpanded] = useState(true);
    const [groupsExpanded, setGroupsExpanded] = useState(true);
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
        dmPeerAccount,
    }: {
        conv: ConversationSnapshot;
        avatarAccount: string | null;
        title: string;
        subtitle?: string;
        fullTitle?: string;
        /** Other DM participant — drives presence dot when `presenceByAccount` is set. */
        dmPeerAccount?: string | null;
    }) => {
        const dmPresence =
            dmPeerAccount && presenceByAccount
                ? (presenceByAccount[dmPeerAccount] ?? "unknown")
                : null;

        return (
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
                    "hover:bg-muted/60 flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-left",
                    selectedConversationId === conv.conversationId &&
                        "bg-muted",
                )}
            >
                <Avatar account={avatarAccount} className="size-7 shrink-0" />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium leading-snug">
                        {title}
                    </p>
                    {subtitle ? (
                        <p className="text-muted-foreground truncate text-[14px] leading-snug">
                            {subtitle}
                        </p>
                    ) : null}
                </div>
                {undeliveredByConversation[conv.conversationId] ? (
                    <span
                        className="inline-flex min-w-5 shrink-0 justify-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
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
                {dmPresence !== null ? (
                    <PresenceDot status={dmPresence} />
                ) : null}
            </button>
        );
    };

    return (
        <div ref={containerRef} className="w-full">
            <SectionToggle
                expanded={dmsExpanded}
                onToggle={() => setDmsExpanded((v) => !v)}
            >
                Direct Messages
            </SectionToggle>
            {dmsExpanded ? (
                <div
                    className="flex flex-col gap-1 overflow-y-auto px-4 pb-2"
                    style={{
                        maxHeight: `${MAX_VISIBLE_DM_ITEMS * CONVERSATION_ROW_HEIGHT_PX}px`,
                    }}
                >
                    {dms.length === 0 ? (
                        <p className="text-muted-foreground px-1 py-2 text-[14px]">
                            None - click a Contact (below) to start.
                        </p>
                    ) : (
                        dms.map((c) => {
                            const peerAccount =
                                c.members.find((m) => m !== self) ??
                                c.members[0] ??
                                null;
                            const resolve =
                                resolveGroupMemberLabel ?? ((a: string) => a);
                            const nick = peerAccount
                                ? resolve(peerAccount)
                                : "(unknown)";
                            const fullTitle =
                                peerAccount && nick !== peerAccount
                                    ? `${nick} (${peerAccount})`
                                    : undefined;
                            return (
                                <Row
                                    key={c.conversationId}
                                    conv={c}
                                    avatarAccount={peerAccount}
                                    title={nick}
                                    subtitle={undefined}
                                    fullTitle={fullTitle}
                                    dmPeerAccount={peerAccount}
                                />
                            );
                        })
                    )}
                </div>
            ) : null}

            <SectionToggle
                expanded={groupsExpanded}
                onToggle={() => setGroupsExpanded((v) => !v)}
            >
                Group Chats
            </SectionToggle>
            {groupsExpanded ? (
                <>
                    {groupPickMode ? (
                        <p className="text-muted-foreground px-4 pb-2 text-[14px] leading-snug">
                            Select members in Contact section below.
                        </p>
                    ) : null}
                    {groupActions ? (
                        <div className="flex flex-wrap gap-2 px-4 pb-2">
                            {groupActions}
                        </div>
                    ) : null}
                    <div className="flex flex-col gap-1 px-4 pb-6">
                        {groups.length === 0 ? (
                            <p className="text-muted-foreground px-1 py-2 text-[14px] leading-snug">
                                No groups yet. Select at least two others in
                                Contacts below to start a group chat.
                            </p>
                        ) : (
                            groups.map((c) => {
                                const others = c.members.filter(
                                    (m) => m !== self,
                                );
                                const avatarAccount =
                                    others[0] ?? c.members[0] ?? null;
                                const fullTitle =
                                    formatGroupConversationFullTitle(
                                        c,
                                        self || undefined,
                                        resolveGroupMemberLabel,
                                    );
                                const title = formatGroupConversationLabel(
                                    c,
                                    self || undefined,
                                    groupMaxChars,
                                    resolveGroupMemberLabel,
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
                </>
            ) : null}
        </div>
    );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
    CallTimelineEventType,
    ConversationSnapshot,
} from "../lib/protocol";
import { PslackWsClient, type PslackWsPublicState } from "../lib/ws-client";
import { supervisor } from "@shared/lib/supervisor";

export type PslackMessageStatus = "pending" | "sent" | "failed";

/** One plain chat bubble row (outbound correlates via clientMsgId). */
export type PslackUiMessage = {
    /** Stable React key — clientMsgId for optimistic rows, else `srv-${serverMsgId}`. */
    key: string;
    clientMsgId?: string;
    serverMsgId?: number;
    from: string;
    body: string;
    serverTime: number;
    status: PslackMessageStatus;
    errorReason?: string;
};

export type PslackTimelineMessageRow = PslackUiMessage & { kind: "message" };

export type PslackTimelineCallEventRow = {
    kind: "callEvent";
    key: string;
    conversationId: string;
    callId?: string;
    event: CallTimelineEventType;
    actor?: string;
    reason?: string;
    durationMs?: number;
    serverMsgId: number;
    serverTime: number;
};

export type PslackTimelineRow =
    | PslackTimelineMessageRow
    | PslackTimelineCallEventRow;

export type PresenceUi = "online" | "offline" | "unknown";

function memberCanonicalKey(members: readonly string[]): string {
    return [...members].sort().join("|");
}

function userMessageForServerError(code: string, reason: string): string {
    if (
        code === "bad-frame" &&
        reason === "openDm member must be a different account"
    ) {
        return "Direct messages are for another account. Choose a contact other than yourself.";
    }

    return reason;
}

async function getActiveQueryToken(): Promise<string | null> {
    const user = await supervisor.functionCall({
        service: "accounts",
        intf: "api",
        method: "get-current-user",
        params: [],
    });
    if (!user) return null;

    const activeApp = await supervisor.functionCall({
        service: "host",
        plugin: "common",
        intf: "client",
        method: "get-active-app",
        params: [],
    });
    if (!activeApp) return null;

    return supervisor.functionCall({
        service: "host",
        plugin: "auth",
        intf: "api",
        method: "get-active-query-token",
        params: [activeApp, user],
    });
}

function upsertConversation(
    prev: ConversationSnapshot[],
    next: ConversationSnapshot,
): ConversationSnapshot[] {
    const ix = prev.findIndex((c) => c.conversationId === next.conversationId);
    if (ix < 0) return [...prev, next];
    const copy = [...prev];
    copy[ix] = next;
    return copy;
}

/** WebSocket-backed chat surface state for x-pslack. */
export function usePslackSocket() {
    const [wsState, setWsState] = useState<PslackWsPublicState>("idle");
    const [lastWsError, setLastWsError] = useState<string | null>(null);

    /** True after first `sync` frame in this session. */
    const [syncedOnce, setSyncedOnce] = useState(false);

    const [selfAccount, setSelfAccount] = useState<string | null>(null);
    const [presenceByAccount, setPresenceByAccount] = useState<
        Record<string, PresenceUi>
    >({});
    const [conversations, setConversations] = useState<ConversationSnapshot[]>(
        [],
    );
    const [timelineByConversation, setTimelineByConversation] = useState<
        Record<string, PslackTimelineRow[]>
    >({});
    const [selectedConversationId, setSelectedConversationId] = useState<
        string | undefined
    >();

    const [lastInboundError, setLastInboundError] = useState<string | null>(null);

    const clientRef = useRef<PslackWsClient | null>(null);
    const selfRef = useRef<string | null>(null);
    const conversationIdsRef = useRef<string[]>([]);
    const conversationsRef = useRef<ConversationSnapshot[]>([]);

    const pendingDmMemberRef = useRef<string | null>(null);
    const pendingGroupKeyRef = useRef<string | null>(null);

    conversationsRef.current = conversations;

    const trySelectPendingConversation = useCallback(
        (conv: ConversationSnapshot) => {
            const self = selfRef.current;
            if (!self) return;

            const pendDm = pendingDmMemberRef.current;
            if (pendDm !== null && conv.kind === "dm") {
                if (
                    conv.members.includes(pendDm) &&
                    conv.members.includes(self)
                ) {
                    pendingDmMemberRef.current = null;
                    setSelectedConversationId(conv.conversationId);
                }
                return;
            }

            const pendGrp = pendingGroupKeyRef.current;
            if (
                pendGrp !== null &&
                conv.kind === "group" &&
                memberCanonicalKey(conv.members) === pendGrp
            ) {
                pendingGroupKeyRef.current = null;
                setSelectedConversationId(conv.conversationId);
            }
        },
        [],
    );

    const markConversationSendFailed = useCallback(
        (conversationId: string | undefined, detail: string) => {
            if (!conversationId) return;
            setTimelineByConversation((prev) => {
                const arr = [...(prev[conversationId] ?? [])];
                for (let i = arr.length - 1; i >= 0; i--) {
                    const row = arr[i];
                    if (
                        row?.kind === "message" &&
                        row.status === "pending"
                    ) {
                        arr[i] = {
                            ...row,
                            status: "failed",
                            errorReason: detail,
                        };
                        break;
                    }
                }
                return { ...prev, [conversationId]: arr };
            });
        },
        [],
    );

    useEffect(() => {
        const client = new PslackWsClient({
            authTokenProvider: getActiveQueryToken,

            reconnect: {
                initialDelayMs: 500,
                maxDelayMs: 30_000,
            },

            onState: (state) => {
                setWsState(state);
            },

            onFrame: (_frame) => {
                const c = clientRef.current;
                if (c?.lastError) setLastWsError(c.lastError);
                else setLastWsError(null);
            },

            handlers: {
                welcome: (frame) => {
                    setLastInboundError(null);
                    selfRef.current = frame.user;
                    setSelfAccount(frame.user);
                    const c = clientRef.current;
                    c?.sync([...conversationIdsRef.current]);
                },

                sync: (frame) => {
                    setSyncedOnce(true);
                    setLastInboundError(null);

                    setPresenceByAccount((prev) => {
                        const self = selfRef.current;
                        const merged = { ...prev };
                        for (const row of frame.contacts) {
                            const acct = row.account;
                            if (self && acct === self) continue;
                            merged[acct] =
                                row.presence === "online"
                                    ? "online"
                                    : "offline";
                        }
                        return merged;
                    });

                    const convs = frame.conversations ?? [];
                    setConversations(convs);
                    conversationsRef.current = convs;
                    conversationIdsRef.current = convs.map((c) => c.conversationId);

                    convs.forEach((c) => trySelectPendingConversation(c));
                },

                conversation: (frame) => {
                    setLastInboundError(null);
                    const row: ConversationSnapshot = {
                        conversationId: frame.conversationId,
                        kind: frame.kind,
                        members: frame.members,
                    };
                    setConversations((prev) => {
                        const next = upsertConversation(prev, row);
                        conversationsRef.current = next;
                        conversationIdsRef.current = next.map((c) => c.conversationId);
                        return next;
                    });
                    trySelectPendingConversation(row);
                },

                presence: (frame) => {
                    const self = selfRef.current;
                    if (self && frame.account === self) return;
                    const nextStatus: PresenceUi =
                        frame.status === "online" ? "online" : "offline";
                    setPresenceByAccount((prev) => {
                        if (prev[frame.account] === nextStatus) return prev;
                        return { ...prev, [frame.account]: nextStatus };
                    });
                },

                message: (frame) => {
                    setLastInboundError(null);
                    const {
                        conversationId,
                        from,
                        body,
                        serverMsgId,
                        serverTime,
                        clientMsgId,
                    } = frame;

                    setTimelineByConversation((prev) => {
                        const prevList = [...(prev[conversationId] ?? [])];

                        if (clientMsgId) {
                            const ix = prevList.findIndex(
                                (m) =>
                                    m.kind === "message" &&
                                    m.clientMsgId === clientMsgId,
                            );
                            if (ix >= 0) {
                                const cur = prevList[ix] as PslackTimelineMessageRow;
                                prevList[ix] = {
                                    ...cur,
                                    kind: "message",
                                    key: clientMsgId,
                                    clientMsgId,
                                    serverMsgId,
                                    serverTime,
                                    from,
                                    body,
                                    status: "sent",
                                };
                                return { ...prev, [conversationId]: prevList };
                            }
                        }

                        if (
                            prevList.some(
                                (m) =>
                                    m.kind === "message" &&
                                    m.serverMsgId === serverMsgId,
                            )
                        ) {
                            return prev;
                        }

                        prevList.push({
                            kind: "message",
                            key: `srv-${serverMsgId}`,
                            serverMsgId,
                            from,
                            body,
                            serverTime,
                            status: "sent",
                        });
                        prevList.sort((a, b) => a.serverTime - b.serverTime);
                        return { ...prev, [conversationId]: prevList };
                    });
                },

                callEvent: (frame) => {
                    setLastInboundError(null);
                    const {
                        conversationId,
                        callId,
                        event,
                        actor,
                        reason,
                        durationMs,
                        serverMsgId,
                        serverTime,
                    } = frame;

                    setTimelineByConversation((prev) => {
                        const prevList = [...(prev[conversationId] ?? [])];
                        if (
                            prevList.some(
                                (r) =>
                                    r.kind === "callEvent" &&
                                    r.serverMsgId === serverMsgId,
                            )
                        ) {
                            return prev;
                        }
                        prevList.push({
                            kind: "callEvent",
                            key: `callev-${serverMsgId}`,
                            conversationId,
                            callId,
                            event,
                            actor,
                            reason,
                            durationMs,
                            serverMsgId,
                            serverTime,
                        });
                        prevList.sort((a, b) => a.serverTime - b.serverTime);
                        return { ...prev, [conversationId]: prevList };
                    });
                },

                callError: (frame) => {
                    const detail = `${frame.code}: ${frame.reason}`.slice(0, 500);
                    markConversationSendFailed(frame.conversationId, detail);
                    setLastInboundError(detail);
                },

                error: (frame) => {
                    const detail = userMessageForServerError(
                        frame.code,
                        frame.reason,
                    ).slice(0, 500);

                    markConversationSendFailed(frame.conversationId, detail);
                    setLastInboundError(detail);
                },

                pong: () => {},
            },
        });

        clientRef.current = client;
        client.connect();

        return () => {
            client.close();
            clientRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- single mount client; refs hold latest matchers
    }, []);

    const reconnectNow = useCallback(() => {
        clientRef.current?.reconnectNow();
    }, []);

    const openOrFocusDm = useCallback(
        (otherAccount: string) => {
            const self = selfRef.current;
            const c = clientRef.current;
            if (!self || !c) return;

            if (otherAccount === self) {
                pendingDmMemberRef.current = null;
                setLastInboundError(
                    "Direct messages are for another account. Choose a contact other than yourself.",
                );
                return;
            }

            const existing = conversationsRef.current.find(
                (row) =>
                    row.kind === "dm" &&
                    row.members.includes(otherAccount) &&
                    row.members.includes(self),
            );

            if (existing) {
                pendingDmMemberRef.current = null;
                setSelectedConversationId(existing.conversationId);
                return;
            }

            pendingDmMemberRef.current = otherAccount;
            setLastInboundError(null);
            c.openDm(otherAccount);
        },
        [],
    );

    /**
     * Open a group chat: `others` must be **other** accounts only (not the current user).
     * Server requires at least two distinct others (≥3 members including self).
     */
    const openGroupChat = useCallback((otherAccounts: readonly string[]) => {
        const self = selfRef.current;
        const c = clientRef.current;
        if (!self || !c) return;

        const uniqueOthers = [...new Set(otherAccounts)].filter(
            (a) => a !== self,
        );
        if (uniqueOthers.length < 2) return;

        const key = memberCanonicalKey([self, ...uniqueOthers]);
        pendingGroupKeyRef.current = key;
        c.openGroup(uniqueOthers);
    }, []);

    const sendChatMessage = useCallback(
        (body: string) => {
            const c = clientRef.current;
            const convId = selectedConversationId;
            const from = selfRef.current;
            if (!c || !convId || !from) return;

            const trimmed = body.trim();
            if (!trimmed) return;

            const clientMsgId = crypto.randomUUID();
            c.send(convId, trimmed, clientMsgId);

            setTimelineByConversation((prev) => {
                const list = [...(prev[convId] ?? [])];
                list.push({
                    kind: "message",
                    key: clientMsgId,
                    clientMsgId,
                    from,
                    body: trimmed,
                    serverTime: Date.now(),
                    status: "pending",
                });
                list.sort((a, b) => a.serverTime - b.serverTime);
                return { ...prev, [convId]: list };
            });
        },
        [selectedConversationId],
    );

    const authLost = useMemo(() => {
        const e = lastWsError ?? "";
        return (
            /\b401\b/.test(e) ||
            e.toLowerCase().includes("unauthorized") ||
            e.toLowerCase().includes("/login failed")
        );
    }, [lastWsError]);

    const chatTransportReady = wsState === "synced";

    const composerDisabledReason = useMemo((): string | null => {
        if (authLost) return "Session expired — refresh the page to sign in again.";
        if (wsState === "closed") return "Disconnected.";
        if (wsState === "connecting" || wsState === "idle")
            return "Connecting…";
        if (wsState === "reconnecting") return "Reconnecting…";
        if (!chatTransportReady) return "Waiting for sync…";
        if (!selectedConversationId) return "Select or start a conversation.";
        return null;
    }, [authLost, chatTransportReady, selectedConversationId, wsState]);

    const selectedTimeline = useMemo(() => {
        if (!selectedConversationId) return [];
        return timelineByConversation[selectedConversationId] ?? [];
    }, [timelineByConversation, selectedConversationId]);

    const selectedConversation = useMemo(
        () =>
            conversations.find((c) => c.conversationId === selectedConversationId),
        [conversations, selectedConversationId],
    );

    return {
        wsState,
        lastWsError,
        lastInboundError,
        syncedOnce,
        authLost,
        reconnectNow,

        selfAccount,
        presenceByAccount,
        conversations,
        selectedConversationId,
        setSelectedConversationId,
        selectedConversation,
        selectedTimeline,

        openOrFocusDm,
        openGroupChat,
        sendChatMessage,

        chatTransportReady,
        composerDisabledReason,
    };
}

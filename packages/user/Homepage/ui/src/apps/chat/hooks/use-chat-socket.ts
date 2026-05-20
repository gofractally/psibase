import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
    CallTimelineEventType,
    ConversationSnapshot,
    IceServerConfig,
} from "../lib/protocol";

import type {
    InboundCallAnswer,
    InboundCallCandidate,
    InboundCallMediaState,
    InboundCallOffer,
} from "../lib/call-webrtc-session";
import {
    RealtimeClient,
    type RealtimeConnectionState,
} from "../lib/realtime-client";
import { PslackWsClient, type PslackWsPublicState } from "../lib/ws-client";

import { ensureDm, ensureGroup, fetchMySpaces } from "../lib/chat-api";
import {
    conversationVisibleToUser,
    isInboundContactPeer,
} from "../lib/contacts-policy";
import {
    isDeliveryOpenPeer,
    markDeliveryOpenPeer,
} from "../lib/delivery-open-peers";
import {
    pslackConversationIdFromSpaceUuid,
    spaceEntryToConversation,
    spaceUuidFromPslackConversationId,
    type GraphqlSpaceEntry,
} from "../lib/space-bridge";

import { useCallSession } from "./use-call-session";
import { getHomepageQueryToken } from "../lib/ws-auth";

import { useContacts } from "@shared/hooks/use-contacts";
import { useCurrentUser } from "@shared/hooks/use-current-user";

const TERMINAL_CALL_TIMELINE_EVENTS = new Set<CallTimelineEventType>([
    "declined",
    "missed",
    "cancelled",
    "failed",
    "ended",
]);

/** Cleared-call IDs — suppress spurious `bad-call` from late signaling after teardown (decline, hangup, etc.). */
const SIGNALING_TEARDOWN_SUPPRESS_MS = 12_000;
const PENDING_STORAGE_PREFIX = "pslack.pendingMessages.v1";

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
    pendingRecipientCount?: number;
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

type PendingChatMessage = {
    clientMsgId: string;
    conversationId: string;
    from: string;
    body: string;
    createdAt: number;
    recipients: string[];
    deliveredTo: string[];
    status: PslackMessageStatus;
    errorReason?: string;
};

function pendingStorageKey(account: string): string {
    return `${PENDING_STORAGE_PREFIX}.${account}`;
}

function sortTimelineRows(rows: PslackTimelineRow[]): PslackTimelineRow[] {
    return rows.sort((a, b) => a.serverTime - b.serverTime);
}

function pendingRecipientCount(pending: PendingChatMessage): number {
    const delivered = new Set(pending.deliveredTo);
    return pending.recipients.filter((recipient) => !delivered.has(recipient))
        .length;
}

function pendingToTimelineRow(pending: PendingChatMessage): PslackTimelineMessageRow {
    return {
        kind: "message",
        key: pending.clientMsgId,
        clientMsgId: pending.clientMsgId,
        from: pending.from,
        body: pending.body,
        serverTime: pending.createdAt,
        status: pending.status,
        errorReason: pending.errorReason,
        pendingRecipientCount: pendingRecipientCount(pending),
    };
}

function parsePendingMessages(raw: string | null): PendingChatMessage[] {
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data
        .filter((row): row is PendingChatMessage => {
            if (typeof row !== "object" || row === null) return false;
            const r = row as Record<string, unknown>;
            return (
                typeof r.clientMsgId === "string" &&
                typeof r.conversationId === "string" &&
                typeof r.from === "string" &&
                typeof r.body === "string" &&
                typeof r.createdAt === "number" &&
                Array.isArray(r.recipients) &&
                r.recipients.every((v) => typeof v === "string") &&
                Array.isArray(r.deliveredTo) &&
                r.deliveredTo.every((v) => typeof v === "string") &&
                (r.status === "pending" ||
                    r.status === "sent" ||
                    r.status === "failed")
            );
        })
        .map((row) => ({
            ...row,
            recipients: [...new Set(row.recipients)],
            deliveredTo: [...new Set(row.deliveredTo)],
        }));
}

export type PslackIncomingCall = {
    callId: string;
    conversationId: string;
    from: string;
    to: string;
    wantVideo: boolean;
    wantAudio: boolean;
    serverTime: number;
    source: "service-frame";
};

export type PslackActiveCall = {
    callId: string;
    conversationId: string;
    peerAccount: string;
    direction: "incoming" | "outgoing";
    wantVideo: boolean;
    wantAudio: boolean;
    startedAt: number;
    status: "ringing" | "connected" | "ended";
    source: "mock" | "service-frame";
    lastFrame?: string;
};

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
    return getHomepageQueryToken();
}

/** Chat UI state: objective Spaces (GraphQL) + x-webrtcsig presence + x-pslack chat socket (M2). */
export function useChatSocket() {
    const { data: currentUser } = useCurrentUser();
    const { data: contactsData, isSuccess: contactsLoaded } =
        useContacts(currentUser);

    const contactAccounts = useMemo(
        () => new Set(contactsData?.map((c) => c.account) ?? []),
        [contactsData],
    );
    const contactAccountsRef = useRef(contactAccounts);
    contactAccountsRef.current = contactAccounts;
    const contactsLoadedRef = useRef(contactsLoaded);
    contactsLoadedRef.current = contactsLoaded;

    const [connectionState, setConnectionState] =
        useState<RealtimeConnectionState>("offline");
    const [lastRealtimeError, setLastRealtimeError] = useState<string | null>(
        null,
    );
    /** True after first `presenceSnapshot` on x-webrtcsig. */
    const [presenceReady, setPresenceReady] = useState(false);

    const [wsState, setWsState] = useState<PslackWsPublicState>("idle");
    const [lastWsError, setLastWsError] = useState<string | null>(null);

    /** True after first `sync` frame in this session. */
    const [syncedOnce, setSyncedOnce] = useState(false);

    const [selfAccount, setSelfAccount] = useState<string | null>(null);
    const [presenceByAccount, setPresenceByAccount] = useState<
        Record<string, PresenceUi>
    >({});
    const [objectiveSpaces, setObjectiveSpaces] = useState<
        GraphqlSpaceEntry[]
    >([]);
    const [spacesLoadError, setSpacesLoadError] = useState<string | null>(null);
    const [timelineByConversation, setTimelineByConversation] = useState<
        Record<string, PslackTimelineRow[]>
    >({});
    const [pendingMessages, setPendingMessages] = useState<
        Record<string, PendingChatMessage>
    >({});
    const [unreadByConversation, setUnreadByConversation] = useState<
        Record<string, number>
    >({});
    const [selectedConversationId, setSelectedConversationId] = useState<
        string | undefined
    >();
    const [incomingCall, setIncomingCall] = useState<PslackIncomingCall | null>(
        null,
    );
    const [activeCall, setActiveCall] = useState<PslackActiveCall | null>(null);

    const iceServersRef = useRef<IceServerConfig[] | null>(null);
    const webrtcBridgeRef = useRef<{
        onOffer?: (frame: InboundCallOffer) => void;
        onAnswer?: (frame: InboundCallAnswer) => void;
        onCandidate?: (frame: InboundCallCandidate) => void;
        onMediaState?: (frame: InboundCallMediaState) => void;
    }>({});

    const [lastInboundError, setLastInboundError] = useState<string | null>(null);

    const clientRef = useRef<PslackWsClient | null>(null);
    const realtimeClientRef = useRef<RealtimeClient | null>(null);
    const selfRef = useRef<string | null>(null);

    const shouldAcceptInboundFrom = (account: string): boolean =>
        isInboundContactPeer(
            selfRef.current,
            account,
            contactAccountsRef.current,
            contactsLoadedRef.current,
        );

    const conversationIdsRef = useRef<string[]>([]);
    const objectiveSpacesRef = useRef<GraphqlSpaceEntry[]>([]);
    const selectedConversationIdRef = useRef<string | undefined>(undefined);
    const pendingMessagesRef = useRef<Record<string, PendingChatMessage>>({});
    const storageFailureRef = useRef<string | null>(null);
    const inFlightDeliveriesRef = useRef<Set<string>>(new Set());

    const pendingDmMemberRef = useRef<string | null>(null);
    const pendingGroupKeyRef = useRef<string | null>(null);

    const ringOutTimerRef = useRef<ReturnType<
        typeof globalThis.setTimeout
    > | null>(null);

    const activeCallRef = useRef<PslackActiveCall | null>(null);
    const hangupInitiatedCallIdRef = useRef<string | null>(null);
    const recentSignalingTeardownIdsRef = useRef<Set<string>>(new Set());

    const markSignalingTeardown = useCallback(
        (callId: string | undefined) => {
            if (!callId) return;
            recentSignalingTeardownIdsRef.current.add(callId);
            globalThis.setTimeout(() => {
                recentSignalingTeardownIdsRef.current.delete(callId);
            }, SIGNALING_TEARDOWN_SUPPRESS_MS);
        },
        [],
    );

    objectiveSpacesRef.current = objectiveSpaces;

    const conversations = useMemo(() => {
        const self = selfAccount;
        if (!self) return [];
        return objectiveSpaces
            .map(spaceEntryToConversation)
            .filter((conv) =>
                conversationVisibleToUser(
                    conv,
                    self,
                    contactAccounts,
                    contactsLoaded,
                ),
            );
    }, [objectiveSpaces, selfAccount, contactAccounts, contactsLoaded]);

    useEffect(() => {
        if (!selectedConversationId || !contactsLoaded) return;
        if (
            !conversations.some(
                (c) => c.conversationId === selectedConversationId,
            )
        ) {
            setSelectedConversationId(undefined);
        }
    }, [conversations, contactsLoaded, selectedConversationId]);

    const conversationsRef = useRef<ConversationSnapshot[]>([]);
    conversationsRef.current = conversations;

    const loadObjectiveSpaces = useCallback(async () => {
        try {
            const spaces = await fetchMySpaces();
            objectiveSpacesRef.current = spaces;
            setObjectiveSpaces(spaces);
            setSpacesLoadError(null);
            return spaces;
        } catch (e) {
            const detail =
                e instanceof Error ? e.message : "Could not load chat spaces.";
            setSpacesLoadError(detail);
            throw e;
        }
    }, []);

    const pslackIdsForSpaces = useCallback((spaces: GraphqlSpaceEntry[]) => {
        return spaces.map((space) =>
            pslackConversationIdFromSpaceUuid(space.space_uuid),
        );
    }, []);

    useEffect(() => {
        const self = selfAccount;
        const visible = self
            ? objectiveSpaces.filter((entry) =>
                  conversationVisibleToUser(
                      spaceEntryToConversation(entry),
                      self,
                      contactAccounts,
                      contactsLoaded,
                  ),
              )
            : [];
        conversationIdsRef.current = pslackIdsForSpaces(visible);
    }, [
        objectiveSpaces,
        selfAccount,
        contactAccounts,
        contactsLoaded,
        pslackIdsForSpaces,
    ]);

    useEffect(() => {
        if (!selfAccount) return;
        void loadObjectiveSpaces();
    }, [selfAccount, loadObjectiveSpaces]);

    const syncPslackKnownConversations = useCallback(() => {
        clientRef.current?.sync([...conversationIdsRef.current]);
    }, []);

    selectedConversationIdRef.current = selectedConversationId;
    pendingMessagesRef.current = pendingMessages;

    activeCallRef.current = activeCall;
    if (!activeCall) hangupInitiatedCallIdRef.current = null;

    const incomingCallRef = useRef<PslackIncomingCall | null>(null);
    incomingCallRef.current = incomingCall;

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

    const selectSpaceByMembers = useCallback(
        (members: readonly string[]) => {
            const key = memberCanonicalKey(members);
            const match = conversationsRef.current.find(
                (row) => memberCanonicalKey(row.members) === key,
            );
            if (match) {
                setSelectedConversationId(match.conversationId);
            }
        },
        [],
    );

    const markConversationSendFailed = useCallback(
        (conversationId: string | undefined, detail: string) => {
            if (!conversationId) return;
            const spaceConvId = spaceUuidFromPslackConversationId(conversationId);
            setTimelineByConversation((prev) => {
                const arr = [...(prev[spaceConvId] ?? [])];
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
                return { ...prev, [spaceConvId]: arr };
            });
        },
        [],
    );

    const persistPendingMessages = useCallback(
        (next: Record<string, PendingChatMessage>) => {
            const self = selfRef.current;
            if (!self) return true;
            try {
                const rows = Object.values(next).filter(
                    (row) => row.status !== "sent",
                );
                globalThis.localStorage.setItem(
                    pendingStorageKey(self),
                    JSON.stringify(rows),
                );
                storageFailureRef.current = null;
                return true;
            } catch (e) {
                const detail =
                    e instanceof Error
                        ? e.message
                        : "Could not write pending message storage.";
                storageFailureRef.current = detail;
                setLastInboundError(
                    `Pending message storage failed: ${detail}. This browser cannot safely queue offline messages.`,
                );
                return false;
            }
        },
        [],
    );

    const replacePendingMessages = useCallback(
        (
            updater: (
                prev: Record<string, PendingChatMessage>,
            ) => Record<string, PendingChatMessage>,
        ) => {
            setPendingMessages((prev) => {
                const next = updater(prev);
                pendingMessagesRef.current = next;
                persistPendingMessages(next);
                return next;
            });
        },
        [persistPendingMessages],
    );

    const upsertPendingTimelineRow = useCallback(
        (pending: PendingChatMessage) => {
            const row = pendingToTimelineRow(pending);
            const spaceId = spaceUuidFromPslackConversationId(
                pending.conversationId,
            );
            setTimelineByConversation((prev) => {
                const list = [...(prev[spaceId] ?? [])];
                const ix = list.findIndex(
                    (item) =>
                        item.kind === "message" &&
                        item.clientMsgId === pending.clientMsgId,
                );
                if (ix >= 0) list[ix] = { ...list[ix], ...row };
                else list.push(row);
                return {
                    ...prev,
                    [spaceId]: sortTimelineRows(list),
                };
            });
        },
        [],
    );

    const applyInboundChatMessage = useCallback(
        (frame: {
            conversationId: string;
            from: string;
            body: string;
            serverMsgId: number;
            serverTime: number;
            clientMsgId?: string;
            clientTime?: number;
        }) => {
            const self = selfRef.current;
            if (!self || frame.from === self) return;

            const spaceId = spaceUuidFromPslackConversationId(
                frame.conversationId,
            );
            const selectedId = selectedConversationIdRef.current;
            if (spaceId !== selectedId) {
                setUnreadByConversation((prev) => ({
                    ...prev,
                    [spaceId]: (prev[spaceId] ?? 0) + 1,
                }));
            }

            setTimelineByConversation((prev) => {
                const prevList = [...(prev[spaceId] ?? [])];
                const {
                    clientMsgId,
                    clientTime,
                    serverMsgId,
                    serverTime,
                    from,
                    body,
                } = frame;

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
                            serverTime: clientTime ?? serverTime,
                            from,
                            body,
                            status: "sent",
                        };
                        return { ...prev, [spaceId]: prevList };
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
                    serverTime: clientTime ?? serverTime,
                    status: "sent",
                });
                sortTimelineRows(prevList);
                return { ...prev, [spaceId]: prevList };
            });
        },
        [],
    );

    const applyInboundChatMessageRef = useRef(applyInboundChatMessage);
    applyInboundChatMessageRef.current = applyInboundChatMessage;

    const flushPendingMessages = useCallback(
        (options?: { forceRecipients?: ReadonlySet<string> }) => {
            const c = clientRef.current;
            const self = selfRef.current;
            if (!c || !self || c.state !== "synced") return;
            const presence = presenceByAccount;
            for (const pending of Object.values(pendingMessagesRef.current)) {
                if (pending.status !== "pending") continue;
                const delivered = new Set(pending.deliveredTo);
                for (const recipient of pending.recipients) {
                    if (delivered.has(recipient)) continue;
                    if (presence[recipient] !== "online") continue;
                    const force = options?.forceRecipients?.has(recipient);
                    if (
                        !force &&
                        !isDeliveryOpenPeer(self, recipient)
                    ) {
                        continue;
                    }
                    const flightKey = `${pending.clientMsgId}:${recipient}`;
                    if (inFlightDeliveriesRef.current.has(flightKey)) continue;
                    inFlightDeliveriesRef.current.add(flightKey);
                    globalThis.setTimeout(() => {
                        inFlightDeliveriesRef.current.delete(flightKey);
                    }, 5_000);
                    c.send(
                        pending.conversationId,
                        pending.body,
                        pending.clientMsgId,
                        pending.createdAt,
                        recipient,
                    );
                }
            }
        },
        [presenceByAccount],
    );

    const flushPendingMessagesRef = useRef(flushPendingMessages);
    flushPendingMessagesRef.current = flushPendingMessages;

    useEffect(() => {
        const realtime = new RealtimeClient({
            authTokenProvider: getActiveQueryToken,
            reconnect: {
                initialDelayMs: 500,
                maxDelayMs: 30_000,
            },
            onState: (state) => {
                setConnectionState(state);
                if (state === "offline") {
                    setPresenceReady(false);
                }
            },
            onFrame: () => {
                const c = realtimeClientRef.current;
                if (c?.lastError) setLastRealtimeError(c.lastError);
                else setLastRealtimeError(null);
            },
            handlers: {
                welcome: (frame) => {
                    setLastRealtimeError(null);
                    selfRef.current = frame.user;
                    setSelfAccount(frame.user);
                    iceServersRef.current = frame.iceServers;
                },
                presenceSnapshot: (frame) => {
                    setPresenceReady(true);
                    setLastRealtimeError(null);
                    setPresenceByAccount((prev) => {
                        const self = selfRef.current;
                        const merged = { ...prev };
                        for (const row of frame.contacts) {
                            const acct = row.account;
                            if (self && acct === self) continue;
                            if (!shouldAcceptInboundFrom(acct)) continue;
                            merged[acct] =
                                row.presence === "online"
                                    ? "online"
                                    : "offline";
                        }
                        return merged;
                    });
                },
                presence: (frame) => {
                    const self = selfRef.current;
                    if (self && frame.account === self) return;
                    if (!shouldAcceptInboundFrom(frame.account)) return;
                    const nextStatus: PresenceUi =
                        frame.status === "online" ? "online" : "offline";
                    setPresenceByAccount((prev) => {
                        if (prev[frame.account] === nextStatus) return prev;
                        return { ...prev, [frame.account]: nextStatus };
                    });
                },
                error: (frame) => {
                    setLastRealtimeError(
                        `${frame.code}: ${frame.reason}`.slice(0, 500),
                    );
                },
            },
        });

        realtimeClientRef.current = realtime;
        realtime.connect();

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
                    try {
                        const loaded = parsePendingMessages(
                            globalThis.localStorage.getItem(
                                pendingStorageKey(frame.user),
                            ),
                        ).filter((row) => row.status !== "sent");
                        const byId = Object.fromEntries(
                            loaded.map((row) => [row.clientMsgId, row]),
                        );
                        pendingMessagesRef.current = byId;
                        setPendingMessages(byId);
                        for (const row of loaded) {
                            upsertPendingTimelineRow(row);
                        }
                        storageFailureRef.current = null;
                    } catch (e) {
                        const detail =
                            e instanceof Error
                                ? e.message
                                : "Could not read pending message storage.";
                        storageFailureRef.current = detail;
                        setLastInboundError(
                            `Pending message storage is unavailable or corrupted: ${detail}. Offline messages cannot be restored in this browser.`,
                        );
                    }
                    syncPslackKnownConversations();
                },

                sync: (_frame) => {
                    setSyncedOnce(true);
                    setLastInboundError(null);
                    conversationsRef.current.forEach((c) =>
                        trySelectPendingConversation(c),
                    );
                },

                conversation: (frame) => {
                    setLastInboundError(null);
                    const self = selfRef.current;
                    if (!self) return;
                    const row: ConversationSnapshot = {
                        conversationId: spaceUuidFromPslackConversationId(
                            frame.conversationId,
                        ),
                        kind: frame.kind,
                        members: frame.members,
                    };
                    if (
                        !conversationVisibleToUser(
                            row,
                            self,
                            contactAccountsRef.current,
                            contactsLoadedRef.current,
                        )
                    ) {
                        return;
                    }
                    trySelectPendingConversation(row);
                },

                message: (frame) => {
                    const self = selfRef.current;
                    if (!self) return;

                    if (
                        frame.from !== self &&
                        !shouldAcceptInboundFrom(frame.from)
                    ) {
                        return;
                    }

                    setLastInboundError(null);
                    const {
                        conversationId,
                        from,
                        body,
                        serverMsgId,
                        serverTime,
                        clientMsgId,
                        clientTime,
                        to,
                    } = frame;

                    if (from !== self) {
                        markDeliveryOpenPeer(self, from);
                        applyInboundChatMessageRef.current({
                            conversationId,
                            from,
                            body,
                            serverMsgId,
                            serverTime,
                            clientMsgId,
                            clientTime,
                        });
                        if (clientMsgId) {
                            clientRef.current?.ack(
                                conversationId,
                                serverMsgId,
                                clientMsgId,
                            );
                        }
                        globalThis.setTimeout(
                            () => flushPendingMessagesRef.current(),
                            0,
                        );
                        return;
                    }

                    const spaceId =
                        spaceUuidFromPslackConversationId(conversationId);

                    if (clientMsgId && to) {
                        markDeliveryOpenPeer(self, to);
                        inFlightDeliveriesRef.current.delete(`${clientMsgId}:${to}`);
                        let nextPending: PendingChatMessage | undefined;
                        replacePendingMessages((prev) => {
                            const cur = prev[clientMsgId];
                            if (!cur) return prev;
                            const deliveredTo = [...new Set([...cur.deliveredTo, to])];
                            const complete = cur.recipients.every((recipient) =>
                                deliveredTo.includes(recipient),
                            );
                            if (complete) {
                                const { [clientMsgId]: _sent, ...rest } = prev;
                                return rest;
                            }
                            nextPending = {
                                ...cur,
                                deliveredTo,
                                status: "pending",
                            };
                            return { ...prev, [clientMsgId]: nextPending };
                        });
                        if (nextPending) upsertPendingTimelineRow(nextPending);
                        globalThis.setTimeout(
                            () => flushPendingMessagesRef.current(),
                            0,
                        );
                    }

                    setTimelineByConversation((prev) => {
                        const prevList = [...(prev[spaceId] ?? [])];

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
                                    serverTime: clientTime ?? serverTime,
                                    from,
                                    body,
                                    status: pendingMessagesRef.current[
                                        clientMsgId
                                    ]
                                        ? "pending"
                                        : "sent",
                                    pendingRecipientCount:
                                        pendingMessagesRef.current[clientMsgId]
                                            ? pendingRecipientCount(
                                                  pendingMessagesRef.current[
                                                      clientMsgId
                                                  ],
                                              )
                                            : undefined,
                                };
                                return { ...prev, [spaceId]: prevList };
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
                            serverTime: clientTime ?? serverTime,
                            status: "sent",
                        });
                        sortTimelineRows(prevList);
                        return { ...prev, [spaceId]: prevList };
                    });
                },

                callEvent: (frame) => {
                    if (
                        frame.actor &&
                        frame.actor !== selfRef.current &&
                        !shouldAcceptInboundFrom(frame.actor)
                    ) {
                        return;
                    }
                    setLastInboundError(null);
                    const {
                        conversationId: rawConversationId,
                        callId,
                        event,
                        actor,
                        reason,
                        durationMs,
                        serverMsgId,
                        serverTime,
                    } = frame;
                    const spaceId =
                        spaceUuidFromPslackConversationId(rawConversationId);

                    setTimelineByConversation((prev) => {
                        const prevList = [...(prev[spaceId] ?? [])];
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
                            conversationId: spaceId,
                            callId,
                            event,
                            actor,
                            reason,
                            durationMs,
                            serverMsgId,
                            serverTime,
                        });
                        prevList.sort((a, b) => a.serverTime - b.serverTime);
                        return { ...prev, [spaceId]: prevList };
                    });

                    if (
                        callId &&
                        TERMINAL_CALL_TIMELINE_EVENTS.has(event)
                    ) {
                        markSignalingTeardown(callId);
                        if (ringOutTimerRef.current != null) {
                            globalThis.clearTimeout(ringOutTimerRef.current);
                            ringOutTimerRef.current = null;
                        }
                        setIncomingCall((prev) =>
                            prev?.callId === callId ? null : prev,
                        );
                        setActiveCall((prev) =>
                            prev?.callId === callId ? null : prev,
                        );
                    }
                },

                callError: (frame) => {
                    const callId = frame.callId;
                    if (
                        callId &&
                        frame.code === "bad-call" &&
                        recentSignalingTeardownIdsRef.current.has(callId)
                    ) {
                        return;
                    }
                    const detail = `${frame.code}: ${frame.reason}`.slice(0, 500);
                    setLastInboundError(detail);
                    if (ringOutTimerRef.current != null) {
                        globalThis.clearTimeout(ringOutTimerRef.current);
                        ringOutTimerRef.current = null;
                    }
                    if (frame.callId) {
                        setIncomingCall((p) =>
                            p?.callId === frame.callId ? null : p,
                        );
                        setActiveCall((p) =>
                            p?.callId === frame.callId ? null : p,
                        );
                    } else if (frame.conversationId) {
                        setActiveCall((p) =>
                            p?.conversationId === frame.conversationId
                                ? null
                                : p,
                        );
                    }
                },

                callInvite: (frame) => {
                    setLastInboundError(null);
                    const self = selfRef.current;
                    if (!self) return;
                    if (frame.to === self) {
                        if (!shouldAcceptInboundFrom(frame.from)) {
                            clientRef.current?.callDecline(frame.callId);
                            return;
                        }
                        setIncomingCall({
                            ...frame,
                            source: "service-frame",
                        });
                        return;
                    }
                    if (frame.from === self) {
                        if (ringOutTimerRef.current != null) {
                            globalThis.clearTimeout(ringOutTimerRef.current);
                            ringOutTimerRef.current = null;
                        }
                        ringOutTimerRef.current = globalThis.setTimeout(() => {
                            ringOutTimerRef.current = null;
                            clientRef.current?.callHangup(
                                frame.callId,
                                "timeout",
                            );
                        }, 20_000);
                        const spaceConvId = spaceUuidFromPslackConversationId(
                            frame.conversationId,
                        );
                        setActiveCall({
                            callId: frame.callId,
                            conversationId: spaceConvId,
                            peerAccount: frame.to,
                            direction: "outgoing",
                            wantVideo: frame.wantVideo,
                            wantAudio: frame.wantAudio,
                            startedAt: Date.now(),
                            status: "ringing",
                            source: "service-frame",
                            lastFrame: "Ringing…",
                        });
                        setSelectedConversationId(spaceConvId);
                    }
                },

                callAccept: (frame) => {
                    setLastInboundError(null);
                    if (ringOutTimerRef.current != null) {
                        globalThis.clearTimeout(ringOutTimerRef.current);
                        ringOutTimerRef.current = null;
                    }
                    setActiveCall((prev) =>
                        prev?.callId === frame.callId
                            ? {
                                  ...prev,
                                  status: "connected",
                                  lastFrame: `Accepted by ${frame.by}`,
                              }
                            : prev,
                    );
                },

                callDecline: (frame) => {
                    setLastInboundError(null);
                    markSignalingTeardown(frame.callId);
                    if (ringOutTimerRef.current != null) {
                        globalThis.clearTimeout(ringOutTimerRef.current);
                        ringOutTimerRef.current = null;
                    }
                    setIncomingCall((prev) =>
                        prev?.callId === frame.callId ? null : prev,
                    );
                    setActiveCall((prev) =>
                        prev?.callId === frame.callId ? null : prev,
                    );
                },

                callHangup: (frame) => {
                    setLastInboundError(null);
                    markSignalingTeardown(frame.callId);
                    if (ringOutTimerRef.current != null) {
                        globalThis.clearTimeout(ringOutTimerRef.current);
                        ringOutTimerRef.current = null;
                    }
                    setIncomingCall((prev) =>
                        prev?.callId === frame.callId ? null : prev,
                    );
                    setActiveCall((prev) =>
                        prev?.callId === frame.callId ? null : prev,
                    );
                },

                callTimeout: (frame) => {
                    setLastInboundError(null);
                    markSignalingTeardown(frame.callId);
                    if (ringOutTimerRef.current != null) {
                        globalThis.clearTimeout(ringOutTimerRef.current);
                        ringOutTimerRef.current = null;
                    }
                    setIncomingCall((prev) =>
                        prev?.callId === frame.callId ? null : prev,
                    );
                    setActiveCall((prev) =>
                        prev?.callId === frame.callId ? null : prev,
                    );
                },

                iceServers: (frame) => {
                    setLastInboundError(null);
                    iceServersRef.current = frame.servers;
                },

                callOffer: (frame) => {
                    const tracked =
                        incomingCallRef.current?.callId === frame.callId ||
                        activeCallRef.current?.callId === frame.callId;
                    if (!tracked) return;
                    setLastInboundError(null);
                    const f = frame as unknown as InboundCallOffer;
                    webrtcBridgeRef.current.onOffer?.(f);
                },

                callAnswer: (frame) => {
                    const tracked =
                        incomingCallRef.current?.callId === frame.callId ||
                        activeCallRef.current?.callId === frame.callId;
                    if (!tracked) return;
                    setLastInboundError(null);
                    const f = frame as unknown as InboundCallAnswer;
                    webrtcBridgeRef.current.onAnswer?.(f);
                },

                callCandidate: (frame) => {
                    const tracked =
                        incomingCallRef.current?.callId === frame.callId ||
                        activeCallRef.current?.callId === frame.callId;
                    if (!tracked) return;
                    setLastInboundError(null);
                    const f = frame as unknown as InboundCallCandidate;
                    webrtcBridgeRef.current.onCandidate?.(f);
                },

                callMediaState: (frame) => {
                    const tracked =
                        incomingCallRef.current?.callId === frame.callId ||
                        activeCallRef.current?.callId === frame.callId;
                    if (!tracked) return;
                    setLastInboundError(null);
                    const f = frame as unknown as InboundCallMediaState;
                    webrtcBridgeRef.current.onMediaState?.(f);
                },

                error: (frame) => {
                    const detail = userMessageForServerError(
                        frame.code,
                        frame.reason,
                    ).slice(0, 500);

                    if (frame.clientMsgId) {
                        inFlightDeliveriesRef.current.delete(
                            `${frame.clientMsgId}:${frame.to ?? ""}`,
                        );
                        replacePendingMessages((prev) => {
                            const cur = prev[frame.clientMsgId!];
                            if (!cur) return prev;
                            const failed = {
                                ...cur,
                                status: "failed" as const,
                                errorReason: detail,
                            };
                            upsertPendingTimelineRow(failed);
                            return { ...prev, [frame.clientMsgId!]: failed };
                        });
                    } else {
                        markConversationSendFailed(frame.conversationId, detail);
                    }
                    setLastInboundError(detail);
                },

                pong: () => {},
            },
        });

        clientRef.current = client;
        client.connect();

        return () => {
            if (ringOutTimerRef.current != null) {
                globalThis.clearTimeout(ringOutTimerRef.current);
                ringOutTimerRef.current = null;
            }
            realtime.close();
            realtimeClientRef.current = null;
            client.close();
            clientRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- single mount client; refs hold latest matchers
    }, [markSignalingTeardown, upsertPendingTimelineRow]);

    useEffect(() => {
        flushPendingMessages();
    }, [flushPendingMessages, pendingMessages, wsState]);

    const reconnectNow = useCallback(() => {
        realtimeClientRef.current?.reconnectNow();
        clientRef.current?.reconnectNow();
    }, []);

    const openOrFocusDm = useCallback(
        async (otherAccount: string) => {
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

            try {
                await ensureDm(otherAccount);
                await loadObjectiveSpaces();
            } catch (e) {
                const detail =
                    e instanceof Error
                        ? e.message
                        : "Could not create DM space.";
                setLastInboundError(detail);
                return;
            }

            const refreshed = conversationsRef.current.find(
                (row) =>
                    row.kind === "dm" &&
                    row.members.includes(otherAccount) &&
                    row.members.includes(self),
            );

            if (refreshed ?? existing) {
                pendingDmMemberRef.current = null;
                setSelectedConversationId(
                    (refreshed ?? existing)!.conversationId,
                );
            } else {
                pendingDmMemberRef.current = otherAccount;
            }

            setLastInboundError(null);
            c.openDm(otherAccount);
            conversationIdsRef.current = pslackIdsForSpaces(
                objectiveSpacesRef.current,
            );
            c.sync(conversationIdsRef.current);
        },
        [loadObjectiveSpaces, pslackIdsForSpaces],
    );

    /**
     * Open a group chat: `others` must be **other** accounts only (not the current user).
     * Server requires at least two distinct others (≥3 members including self).
     */
    const openGroupChat = useCallback(
        async (otherAccounts: readonly string[]) => {
            const self = selfRef.current;
            const c = clientRef.current;
            if (!self || !c) return;

            const uniqueOthers = [...new Set(otherAccounts)].filter(
                (a) => a !== self,
            );
            if (uniqueOthers.length < 2) return;

            const key = memberCanonicalKey([self, ...uniqueOthers]);
            pendingGroupKeyRef.current = key;

            try {
                await ensureGroup(uniqueOthers);
                await loadObjectiveSpaces();
            } catch (e) {
                pendingGroupKeyRef.current = null;
                const detail =
                    e instanceof Error
                        ? e.message
                        : "Could not create group space.";
                setLastInboundError(detail);
                return;
            }

            selectSpaceByMembers([self, ...uniqueOthers]);
            setLastInboundError(null);
            c.openGroup(uniqueOthers);
            conversationIdsRef.current = pslackIdsForSpaces(
                objectiveSpacesRef.current,
            );
            c.sync(conversationIdsRef.current);
        },
        [loadObjectiveSpaces, pslackIdsForSpaces, selectSpaceByMembers],
    );

    const sendChatMessage = useCallback(
        (body: string) => {
            const convId = selectedConversationId;
            const from = selfRef.current;
            if (!convId || !from) return;

            const trimmed = body.trim();
            if (!trimmed) return;

            const conversation = conversationsRef.current.find(
                (row) => row.conversationId === convId,
            );
            if (!conversation) return;

            const clientMsgId = crypto.randomUUID();
            const recipients = conversation.members.filter(
                (member) => member !== from,
            );
            const pending: PendingChatMessage = {
                clientMsgId,
                conversationId: pslackConversationIdFromSpaceUuid(convId),
                from,
                body: trimmed,
                createdAt: Date.now(),
                recipients,
                deliveredTo: [],
                status: "pending",
            };

            const nextPending = {
                ...pendingMessagesRef.current,
                [clientMsgId]: pending,
            };
            if (!persistPendingMessages(nextPending)) {
                const failed = {
                    ...pending,
                    status: "failed" as const,
                    errorReason:
                        storageFailureRef.current ??
                        "Pending message storage is unavailable.",
                };
                upsertPendingTimelineRow(failed);
                return;
            }

            pendingMessagesRef.current = nextPending;
            setPendingMessages(nextPending);
            upsertPendingTimelineRow(pending);
            globalThis.setTimeout(
                () =>
                    flushPendingMessages({
                        forceRecipients: new Set(recipients),
                    }),
                0,
            );
        },
        [
            flushPendingMessages,
            persistPendingMessages,
            selectedConversationId,
            upsertPendingTimelineRow,
        ],
    );


    const startMeetCall = useCallback(() => {
        const convId = selectedConversationId;
        const self = selfRef.current;
        const c = clientRef.current;
        if (!convId || !self || !c) return;

        const conversation = conversationsRef.current.find(
            (row) => row.conversationId === convId,
        );
        if (
            !conversation ||
            conversation.kind !== "dm" ||
            conversation.members.length !== 2 ||
            !conversation.members.includes(self)
        ) {
            return;
        }

        const peerAccount = conversation.members.find((m) => m !== self);
        if (!peerAccount) return;

        c.callInvite(
            pslackConversationIdFromSpaceUuid(convId),
            true,
            true,
            crypto.randomUUID(),
        );
    }, [selectedConversationId]);

    const startMockCall = useCallback(() => {
        const convId = selectedConversationId;
        const self = selfRef.current;
        if (!convId || !self) return;

        const conversation = conversationsRef.current.find(
            (c) => c.conversationId === convId,
        );
        if (
            !conversation ||
            conversation.kind !== "dm" ||
            conversation.members.length !== 2 ||
            !conversation.members.includes(self)
        ) {
            return;
        }

        const peerAccount = conversation.members.find((m) => m !== self);
        if (!peerAccount) return;

        setActiveCall({
            callId: `mock-${crypto.randomUUID()}`,
            conversationId: convId,
            peerAccount,
            direction: "outgoing",
            wantVideo: true,
            wantAudio: true,
            startedAt: Date.now(),
            status: "ringing",
            source: "mock",
            lastFrame: "Mock outgoing call preview",
        });
    }, [selectedConversationId]);

    const acceptIncomingCall = useCallback(() => {
        setIncomingCall((call) => {
            if (!call) return null;
            clientRef.current?.callAccept(call.callId);
            const spaceConvId = spaceUuidFromPslackConversationId(
                call.conversationId,
            );
            setActiveCall({
                callId: call.callId,
                conversationId: spaceConvId,
                peerAccount: call.from,
                direction: "incoming",
                wantVideo: call.wantVideo,
                wantAudio: call.wantAudio,
                startedAt: Date.now(),
                status: "connected",
                source: "service-frame",
                lastFrame: "Connected",
            });
            setSelectedConversationId(spaceConvId);
            return null;
        });
    }, []);

    const declineIncomingCall = useCallback(
        (reason: "user" | "timeout") => {
            setLastInboundError(null);
            setIncomingCall((call) => {
                if (!call) return null;
                markSignalingTeardown(call.callId);
                if (reason === "timeout") {
                    clientRef.current?.callDecline(call.callId, "timeout");
                } else {
                    clientRef.current?.callDecline(call.callId);
                }
                return null;
            });
        },
        [markSignalingTeardown],
    );

    const endPlaceholderCall = useCallback(() => {
        if (ringOutTimerRef.current != null) {
            globalThis.clearTimeout(ringOutTimerRef.current);
            ringOutTimerRef.current = null;
        }
        const ac = activeCallRef.current;
        if (!ac) return;
        if (hangupInitiatedCallIdRef.current === ac.callId) return;
        hangupInitiatedCallIdRef.current = ac.callId;

        if (ac.source === "service-frame") {
            const c = clientRef.current;
            markSignalingTeardown(ac.callId);
            if (ac.status === "ringing" && ac.direction === "outgoing") {
                c?.callHangup(ac.callId, "cancelled");
            } else {
                c?.callHangup(ac.callId, "ended");
            }
        } else {
            setLastInboundError(null);
        }
        setActiveCall(null);
    }, [markSignalingTeardown]);

    const callRtcSnapshot = useMemo(() => {
        const ac = activeCall;
        if (
            ac &&
            ac.source === "service-frame" &&
            ac.status === "connected"
        ) {
            return {
                callId: ac.callId,
                direction: ac.direction,
                wantVideo: ac.wantVideo,
                wantAudio: ac.wantAudio,
            };
        }
        return null;
    }, [activeCall]);

    const onMediaAcquisitionFailed = useCallback((callId: string) => {
        if (activeCallRef.current?.callId !== callId) return;
        setLastInboundError(
            "Could not access camera or microphone for this call.",
        );
        clientRef.current?.callHangup(callId, "ended");
    }, []);

    const onIceFailedHangup = useCallback((callId: string) => {
        setLastInboundError(
            "Could not establish a media connection. The node may have no TURN relay quota left, or this network blocks direct and relay paths. Try another network or ask a node admin to check Chat and OpenRelay settings in x-admin.",
        );
        clientRef.current?.callHangup(callId, "ice-failed");
    }, []);

    const activeCallMediaKey =
        activeCall?.source === "service-frame" &&
        activeCall.status === "connected"
            ? activeCall.callId
            : null;

    const {
        localStream: callLocalStream,
        remoteStream: callRemoteStream,
        audioMuted: callAudioMuted,
        videoMuted: callVideoMuted,
        remoteAudioMuted: callRemoteAudioMuted,
        remoteVideoMuted: callRemoteVideoMuted,
        audioOnlyFallback: callAudioOnlyFallback,
        toggleAudio: toggleCallAudioMuted,
        toggleVideo: toggleCallVideoMuted,
    } = useCallSession({
        mediaCallKey: activeCallMediaKey,
        callSnapshot: callRtcSnapshot,
        wsState,
        iceServersRef,
        clientRef,
        activeCallRef,
        webrtcBridgeRef,
        onMediaAcquisitionFailed,
        onIceFailedHangup,
    });

    const authLost = useMemo(() => {
        const e = `${lastRealtimeError ?? ""} ${lastWsError ?? ""}`;
        return (
            /\b401\b/.test(e) ||
            e.toLowerCase().includes("unauthorized") ||
            e.toLowerCase().includes("/login failed")
        );
    }, [lastRealtimeError, lastWsError]);

    const chatTransportReady = wsState === "synced";

    const composerDisabledReason = useMemo((): string | null => {
        if (spacesLoadError)
            return `Could not load chat spaces: ${spacesLoadError}`;
        if (authLost) return "Session expired — refresh the page to sign in again.";
        if (wsState === "closed") return "Disconnected.";
        if (wsState === "connecting" || wsState === "idle")
            return "Connecting…";
        if (wsState === "reconnecting") return "Reconnecting…";
        if (!chatTransportReady) return "Waiting for sync…";
        if (!selectedConversationId) return "Select or start a conversation.";
        return null;
    }, [authLost, chatTransportReady, selectedConversationId, spacesLoadError, wsState]);

    const selectedTimeline = useMemo(() => {
        if (!selectedConversationId) return [];
        return timelineByConversation[selectedConversationId] ?? [];
    }, [timelineByConversation, selectedConversationId]);

    useEffect(() => {
        if (!selectedConversationId) return;
        setUnreadByConversation((prev) => {
            if (!prev[selectedConversationId]) return prev;
            const next = { ...prev };
            delete next[selectedConversationId];
            return next;
        });
    }, [selectedConversationId, selectedTimeline.length]);

    const selectedConversation = useMemo(
        () =>
            conversations.find((c) => c.conversationId === selectedConversationId),
        [conversations, selectedConversationId],
    );

    const undeliveredByConversation = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const pending of Object.values(pendingMessages)) {
            const count = pendingRecipientCount(pending);
            if (count <= 0) continue;
            const spaceId = spaceUuidFromPslackConversationId(
                pending.conversationId,
            );
            counts[spaceId] = (counts[spaceId] ?? 0) + count;
        }
        return counts;
    }, [pendingMessages]);

    const selectedHasPendingMessages =
        !!selectedConversationId &&
        (undeliveredByConversation[selectedConversationId] ?? 0) > 0;

    return {
        connectionState,
        lastRealtimeError,
        presenceReady,
        wsState,
        lastWsError,
        lastInboundError: spacesLoadError ?? lastInboundError,
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
        unreadByConversation,
        undeliveredByConversation,
        selectedHasPendingMessages,

        openOrFocusDm,
        openGroupChat,
        sendChatMessage,
        incomingCall,
        activeCall,
        startMeetCall,
        startMockCall,
        acceptIncomingCall,
        declineIncomingCall,
        endPlaceholderCall,

        callLocalStream,
        callRemoteStream,
        callAudioMuted,
        callVideoMuted,
        callRemoteAudioMuted,
        callRemoteVideoMuted,
        callAudioOnlyFallback,
        toggleCallAudioMuted,
        toggleCallVideoMuted,

        chatTransportReady,
        composerDisabledReason,
    };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
    CallTimelineEventType,
    ConversationSnapshot,
    IceServerConfig,
} from "../lib/protocol";
import { supervisor } from "@shared/lib/supervisor";

import type {
    InboundCallAnswer,
    InboundCallCandidate,
    InboundCallMediaState,
    InboundCallOffer,
} from "../lib/call-webrtc-session";
import { PslackWsClient, type PslackWsPublicState } from "../lib/ws-client";

import { useCallSession } from "./use-call-session";

const TERMINAL_CALL_TIMELINE_EVENTS = new Set<CallTimelineEventType>([
    "declined",
    "missed",
    "cancelled",
    "failed",
    "ended",
]);

/** Cleared-call IDs — suppress spurious `bad-call` from late signaling after teardown (decline, hangup, etc.). */
const SIGNALING_TEARDOWN_SUPPRESS_MS = 12_000;

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
    const selfRef = useRef<string | null>(null);
    const conversationIdsRef = useRef<string[]>([]);
    const conversationsRef = useRef<ConversationSnapshot[]>([]);

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

    conversationsRef.current = conversations;

    activeCallRef.current = activeCall;
    if (!activeCall) hangupInitiatedCallIdRef.current = null;

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
                        setActiveCall({
                            callId: frame.callId,
                            conversationId: frame.conversationId,
                            peerAccount: frame.to,
                            direction: "outgoing",
                            wantVideo: frame.wantVideo,
                            wantAudio: frame.wantAudio,
                            startedAt: Date.now(),
                            status: "ringing",
                            source: "service-frame",
                            lastFrame: "Ringing…",
                        });
                        setSelectedConversationId(frame.conversationId);
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
                    setLastInboundError(null);
                    const f = frame as unknown as InboundCallOffer;
                    webrtcBridgeRef.current.onOffer?.(f);
                },

                callAnswer: (frame) => {
                    setLastInboundError(null);
                    const f = frame as unknown as InboundCallAnswer;
                    webrtcBridgeRef.current.onAnswer?.(f);
                },

                callCandidate: (frame) => {
                    setLastInboundError(null);
                    const f = frame as unknown as InboundCallCandidate;
                    webrtcBridgeRef.current.onCandidate?.(f);
                },

                callMediaState: (frame) => {
                    setLastInboundError(null);
                    const f = frame as unknown as InboundCallMediaState;
                    webrtcBridgeRef.current.onMediaState?.(f);
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
            if (ringOutTimerRef.current != null) {
                globalThis.clearTimeout(ringOutTimerRef.current);
                ringOutTimerRef.current = null;
            }
            client.close();
            clientRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- single mount client; refs hold latest matchers
    }, [markSignalingTeardown]);

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

        c.callInvite(convId, true, true, crypto.randomUUID());
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
            setActiveCall({
                callId: call.callId,
                conversationId: call.conversationId,
                peerAccount: call.from,
                direction: "incoming",
                wantVideo: call.wantVideo,
                wantAudio: call.wantAudio,
                startedAt: Date.now(),
                status: "connected",
                source: "service-frame",
                lastFrame: "Connected",
            });
            setSelectedConversationId(call.conversationId);
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
            "Could not establish a media connection. The node may have no TURN relay quota left, or this network blocks direct and relay paths. Try another network or ask a node admin to check Pslack / OpenRelay settings in x-admin.",
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

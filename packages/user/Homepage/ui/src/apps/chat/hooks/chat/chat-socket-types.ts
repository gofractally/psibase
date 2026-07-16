import type { GroupMeetParticipant } from "../../lib/group-meet-ui-state";

export type IncomingCall = {
    callId: string;
    conversationId: string;
    from: string;
    to: string;
    wantVideo: boolean;
    wantAudio: boolean;
    serverTime: number;
    source: "av-call";
    /** N-party group Meet when >2 session participants. */
    groupParticipantCount?: number;
};

export type ActiveCall = {
    callId: string;
    conversationId: string;
    peerAccount: string;
    direction: "incoming" | "outgoing";
    wantVideo: boolean;
    wantAudio: boolean;
    startedAt: number;
    status: "ringing" | "connected" | "ended";
    source: "mock" | "av-call";
    lastFrame?: string;
    callKind?: "dm" | "group";
    groupParticipants?: GroupMeetParticipant[];
};

export type UseChatSocketOptions = {
    /** When set (e.g. `?space=`), overrides restored last-open chat. */
    urlConversationId?: string;
};

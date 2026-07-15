import type { AvCallSessionPhase } from "./av-call-session-types";

export type GroupMeetParticipantStatus = "ringing" | "joined" | "offline";

export type GroupMeetParticipant = {
    account: string;
    status: GroupMeetParticipantStatus;
};

export function buildGroupMeetParticipants(
    members: readonly string[],
    self: string,
    presence: Readonly<Record<string, string>>,
    meshReady: Readonly<Record<string, boolean>> | undefined,
    phase: AvCallSessionPhase,
): GroupMeetParticipant[] {
    const remotes = members.filter((m) => m !== self);
    const inCallPhase =
        phase === "ensuring" ||
        phase === "creating" ||
        phase === "joining" ||
        phase === "waiting-peer" ||
        phase === "signaling" ||
        phase === "ready";

    return remotes.map((account) => {
        if (meshReady?.[account]) {
            return { account, status: "joined" as const };
        }
        if (presence[account] !== "online") {
            return { account, status: "offline" as const };
        }
        if (inCallPhase) {
            return { account, status: "ringing" as const };
        }
        return { account, status: "offline" as const };
    });
}

export function groupMeetDisplayPeer(
    participants: readonly GroupMeetParticipant[],
): string {
    const joined = participants.filter((p) => p.status === "joined");
    const ringing = participants.filter((p) => p.status === "ringing");
    if (joined.length === 1) return joined[0]!.account;
    if (joined.length > 1) return `Group Meet (${joined.length} joined)`;
    if (ringing.length === 1) return ringing[0]!.account;
    if (ringing.length > 1) return `Group Meet (${ringing.length} ringing)`;
    return "Group Meet";
}

export function groupMeetStatusLabel(
    participants: readonly GroupMeetParticipant[],
    phase: AvCallSessionPhase,
    isConnected: boolean,
): string {
    if (isConnected) {
        const joined = participants.filter((p) => p.status === "joined").length;
        const ringing = participants.filter((p) => p.status === "ringing")
            .length;
        const offline = participants.filter((p) => p.status === "offline")
            .length;
        const parts: string[] = [];
        if (joined > 0) parts.push(`${joined} joined`);
        if (ringing > 0) parts.push(`${ringing} ringing`);
        if (offline > 0) parts.push(`${offline} offline`);
        return parts.join(" · ") || "Connected";
    }
    switch (phase) {
        case "ensuring":
        case "creating":
            return "Starting group call…";
        case "joining":
            return "Joining session…";
        case "waiting-peer":
            return "Ringing members…";
        case "signaling":
        case "ready":
            return "Connecting…";
        default:
            return "Calling…";
    }
}

export function anyGroupMeetJoined(
    meshReady: Readonly<Record<string, boolean>> | undefined,
): boolean {
    return Object.values(meshReady ?? {}).some(Boolean);
}

/** True when every expected remote in the active session roster has live mesh media. */
export function allSessionGroupMeetJoined(
    self: string,
    joinedParticipants: readonly string[],
    meshReady: Readonly<Record<string, boolean>> | undefined,
): boolean {
    const remotes = joinedParticipants.filter((member) => member !== self);
    if (remotes.length === 0) return false;
    return remotes.every((member) => meshReady?.[member] === true);
}

/** Connected when all online group remotes have mesh media (pre-roster / ringing). */
export function allOnlineGroupMeetJoined(
    members: readonly string[],
    self: string,
    presence: Readonly<Record<string, string>>,
    meshReady: Readonly<Record<string, boolean>> | undefined,
): boolean {
    const remotes = members.filter(
        (member) => member !== self && presence[member] === "online",
    );
    if (remotes.length === 0) return false;
    return remotes.every((member) => meshReady?.[member] === true);
}

export function groupMeetFullyConnected(
    members: readonly string[],
    self: string,
    presence: Readonly<Record<string, string>>,
    joinedParticipants: readonly string[],
    meshReady: Readonly<Record<string, boolean>> | undefined,
): boolean {
    if (joinedParticipants.length > 0) {
        const onlineJoinedRemotes = joinedParticipants.filter(
            (member) => member !== self && presence[member] === "online",
        );
        if (onlineJoinedRemotes.length === 0) {
            return anyGroupMeetJoined(meshReady);
        }
        return onlineJoinedRemotes.every(
            (member) => meshReady?.[member] === true,
        );
    }
    return allOnlineGroupMeetJoined(members, self, presence, meshReady);
}

export type GroupMeetRemoteStreamPeer = {
    getRemoteStream(): MediaStream | null;
};

/** Snapshot remote MediaStreams keyed by peer account from mesh PCs. */
export function buildGroupMeetRemoteStreamMap(
    meshPeers: ReadonlyMap<string, GroupMeetRemoteStreamPeer>,
): Record<string, MediaStream | null> {
    const out: Record<string, MediaStream | null> = {};
    for (const [account, peer] of meshPeers) {
        out[account] = peer.getRemoteStream();
    }
    return out;
}

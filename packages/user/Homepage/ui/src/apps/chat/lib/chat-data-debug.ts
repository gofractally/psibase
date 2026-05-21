import { installChurnTraceGlobal } from "./churn-trace";

/** Console tracing for DM chat-data / WebRTC (disable: localStorage.setItem('chat-data-debug','0')). */
const PREFIX = "[chat-data]";

const RING_MAX = 400;

export type ChatDataDebugEvent = {
    ts: number;
    event: string;
    detail?: Record<string, unknown>;
};

const ring: ChatDataDebugEvent[] = [];

export type ParsedIceCandidate = {
    typ: string;
    address?: string;
    port?: string;
    protocol?: string;
    relatedAddress?: string;
    relatedPort?: string;
};

function tracingEnabled(): boolean {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem("chat-data-debug") !== "0";
}

/** Verbose ICE candidate lines (localStorage chat-data-debug=verbose). */
function verboseIce(): boolean {
    if (typeof localStorage === "undefined") return false;
    const v = localStorage.getItem("chat-data-debug");
    return v === "verbose" || v === "2";
}

/** Realtime websocket transport tracing (localStorage `realtime-trace=1`). */
function realtimeTraceEnabled(): boolean {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem("realtime-trace") === "1";
}

export function realtimeTraceLog(
    event: string,
    detail?: Record<string, unknown>,
): void {
    if (!realtimeTraceEnabled()) return;
    chatDataLog(`realtime:${event}`, detail);
}

export function shortSessionId(sessionId: string): string {
    if (sessionId.length <= 16) return sessionId;
    return `${sessionId.slice(0, 14)}…`;
}

export function shortSpaceId(spaceUuid: string): string {
    if (spaceUuid.length <= 20) return spaceUuid;
    return `${spaceUuid.slice(0, 18)}…`;
}

/** Parse `candidate:… typ host …` lines for logging (not full SDP validation). */
export function parseIceCandidateLine(
    line: string | undefined | null,
): ParsedIceCandidate | null {
    if (!line?.trim()) return null;
    const out: ParsedIceCandidate = { typ: "unknown" };
    for (const part of line.trim().split(/\s+/)) {
        if (part.startsWith("typ")) {
            out.typ = part.split(":").pop() ?? part;
        } else if (part.startsWith("raddr")) {
            out.relatedAddress = part.split(":").pop();
        } else if (part.startsWith("rport")) {
            out.relatedPort = part.split(":").pop();
        }
    }
    const tokens = line.trim().split(/\s+/);
    if (tokens.length >= 6 && tokens[0]?.startsWith("candidate:")) {
        out.address = tokens[4];
        out.port = tokens[5];
        out.protocol = tokens[2];
    }
    return out;
}

export function chatDataLog(
    event: string,
    detail?: Record<string, unknown>,
): void {
    if (!tracingEnabled()) return;
    if (typeof console === "undefined" || typeof console.info !== "function") {
        return;
    }
    if (detail && Object.keys(detail).length > 0) {
        console.info(PREFIX, event, detail);
    } else {
        console.info(PREFIX, event);
    }
}

/** Ring-buffer event + console (used for automated dump via window.__chatDataDebug). */
export function chatDataRecord(
    event: string,
    detail?: Record<string, unknown>,
): void {
    if (!tracingEnabled()) return;
    ring.push({ ts: Date.now(), event, detail });
    if (ring.length > RING_MAX) {
        ring.splice(0, ring.length - RING_MAX);
    }
    chatDataLog(event, detail);
}

export function getChatDataDebugEvents(): readonly ChatDataDebugEvent[] {
    return ring;
}

export function clearChatDataDebugEvents(): void {
    ring.length = 0;
}

type PeerRegistryEntry = {
    sessionId: string;
    selfAccount: string;
    peerAccount: string;
    isInitiator: boolean;
    getPc: () => RTCPeerConnection | null;
};

const peerRegistry = new Map<string, PeerRegistryEntry>();

export function registerChatDataPeer(
    id: string,
    entry: PeerRegistryEntry,
): void {
    peerRegistry.set(id, entry);
}

export function unregisterChatDataPeer(id: string): void {
    peerRegistry.delete(id);
}

/** Summarize getStats() for ICE failure diagnosis (mirrors webrtc-internals highlights). */
export async function summarizePeerConnection(
    pc: RTCPeerConnection,
): Promise<Record<string, unknown>> {
    const summary: Record<string, unknown> = {
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
    };

    try {
        const stats = await pc.getStats();
        const candidatePairs: Record<string, unknown>[] = [];
        const localCandidates: Record<string, unknown>[] = [];
        const remoteCandidates: Record<string, unknown>[] = [];
        const transports: Record<string, unknown>[] = [];

        stats.forEach((report) => {
            if (report.type === "candidate-pair") {
                candidatePairs.push({
                    id: report.id,
                    state: report.state,
                    nominated: report.nominated,
                    selected: report.selected,
                    localCandidateId: report.localCandidateId,
                    remoteCandidateId: report.remoteCandidateId,
                    bytesSent: report.bytesSent,
                    bytesReceived: report.bytesReceived,
                });
            } else if (report.type === "local-candidate") {
                localCandidates.push({
                    id: report.id,
                    candidateType: report.candidateType,
                    address: report.address ?? report.ip,
                    port: report.port,
                    protocol: report.protocol,
                });
            } else if (report.type === "remote-candidate") {
                remoteCandidates.push({
                    id: report.id,
                    candidateType: report.candidateType,
                    address: report.address ?? report.ip,
                    port: report.port,
                    protocol: report.protocol,
                });
            } else if (report.type === "transport") {
                transports.push({
                    id: report.id,
                    dtlsState: report.dtlsState,
                    selectedCandidatePairId: report.selectedCandidatePairId,
                });
            }
        });

        const nominated = candidatePairs.filter((p) => p.nominated || p.selected);
        summary.nominatedPairs = nominated;
        summary.candidatePairCount = candidatePairs.length;
        summary.localCandidates = localCandidates;
        summary.remoteCandidates = remoteCandidates;
        summary.transports = transports;
    } catch (e) {
        summary.statsError =
            e instanceof Error ? e.message : "getStats failed";
    }

    return summary;
}

export function getChatDataDebugSnapshot(): {
    events: readonly ChatDataDebugEvent[];
    peers: {
        id: string;
        sessionId: string;
        selfAccount: string;
        peerAccount: string;
        isInitiator: boolean;
        pc: Record<string, unknown> | null;
    }[];
} {
    const peers: {
        id: string;
        sessionId: string;
        selfAccount: string;
        peerAccount: string;
        isInitiator: boolean;
        pc: Record<string, unknown> | null;
    }[] = [];

    for (const [id, entry] of peerRegistry) {
        const pc = entry.getPc();
        peers.push({
            id,
            sessionId: entry.sessionId,
            selfAccount: entry.selfAccount,
            peerAccount: entry.peerAccount,
            isInitiator: entry.isInitiator,
            pc: pc
                ? {
                      connectionState: pc.connectionState,
                      iceConnectionState: pc.iceConnectionState,
                      iceGatheringState: pc.iceGatheringState,
                      signalingState: pc.signalingState,
                  }
                : null,
        });
    }

    return { events: [...ring], peers };
}

export async function dumpChatDataDebug(label?: string): Promise<string> {
    const lines: string[] = [];
    if (label) lines.push(`=== chat-data debug: ${label} ===`);
    const snap = getChatDataDebugSnapshot();
    lines.push(JSON.stringify(snap, null, 2));
    for (const [, entry] of peerRegistry) {
        const pc = entry.getPc();
        if (!pc) continue;
        lines.push(
            `--- stats ${entry.selfAccount} ↔ ${entry.peerAccount} ---`,
        );
        lines.push(
            JSON.stringify(await summarizePeerConnection(pc), null, 2),
        );
    }
    const text = lines.join("\n");
    chatDataLog("debug dump", { label, bytes: text.length });
    return text;
}

declare global {
    interface Window {
        __chatDataDebug?: {
            dump: (label?: string) => Promise<string>;
            snapshot: () => ReturnType<typeof getChatDataDebugSnapshot>;
            events: () => readonly ChatDataDebugEvent[];
            clear: () => void;
            copyDump: (label?: string) => Promise<void>;
        };
    }
}

let globalInstalled = false;

export function installChatDataDebugGlobal(): void {
    if (globalInstalled || typeof window === "undefined") return;
    globalInstalled = true;
    installChurnTraceGlobal();
    window.__chatDataDebug = {
        dump: dumpChatDataDebug,
        snapshot: getChatDataDebugSnapshot,
        events: getChatDataDebugEvents,
        clear: clearChatDataDebugEvents,
        copyDump: async (label) => {
            const text = await dumpChatDataDebug(label);
            try {
                await navigator.clipboard.writeText(text);
                chatDataLog("debug dump copied to clipboard");
            } catch {
                console.info(text);
            }
        },
    };
    chatDataLog("debug global installed (__chatDataDebug.dump / .copyDump)");
}

export function logIceCandidate(
    direction: "local" | "remote",
    line: string | undefined,
    extra?: Record<string, unknown>,
): void {
    const parsed = parseIceCandidateLine(line);
    if (!parsed) return;
    const detail = { direction, ...parsed, ...extra };
    if (verboseIce()) {
        chatDataRecord("ice candidate", detail);
    } else if (parsed.typ === "relay" || parsed.typ === "host") {
        chatDataRecord("ice candidate", detail);
    } else {
        chatDataLog("ice candidate", detail);
    }
}

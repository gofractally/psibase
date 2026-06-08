/** Thread selection, compose wake, and mesh-live tracing for e2e + manual debug. */
import { shortSpaceId } from "./chat-data-debug";
import { recordChurnTrace } from "./churn-trace";

const PREFIX = "[thread-lifecycle]";
const RING_MAX = 400;

export type ThreadLifecycleEvent = {
    ts: number;
    wall: number;
    event: string;
    detail?: Record<string, unknown>;
};

const ring: ThreadLifecycleEvent[] = [];

function enabled(): boolean {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem("thread-lifecycle") !== "0";
}

/** Cross-layer transport trace (L1–L4) unified into thread-lifecycle ring. */
export function recordTransportLifecycle(
    layer: "l1" | "l2" | "l3" | "pc" | "l4",
    event: string,
    detail?: Record<string, unknown>,
): void {
    recordThreadLifecycle(`transport-${layer}-${event}`, { layer, ...detail });
}

export function recordThreadLifecycle(
    event: string,
    detail?: Record<string, unknown>,
): void {
    if (!enabled()) return;
    const entry: ThreadLifecycleEvent = {
        ts: typeof performance !== "undefined" ? performance.now() : 0,
        wall: Date.now(),
        event,
        detail,
    };
    ring.push(entry);
    if (ring.length > RING_MAX) {
        ring.splice(0, ring.length - RING_MAX);
    }
    recordChurnTrace(`thread:${event}`, detail);
    if (typeof console !== "undefined" && console.info) {
        console.info(PREFIX, entry);
    }
}

export function getThreadLifecycleEvents(): readonly ThreadLifecycleEvent[] {
    return ring;
}

export function clearThreadLifecycleEvents(): void {
    ring.length = 0;
}

export type ThreadPeerStateRow = {
    remote: string;
    state: string;
};

export function peerStatesForRemotes(
    remotes: readonly string[],
    getState: (remote: string) => string,
): ThreadPeerStateRow[] {
    return remotes.map((remote) => ({
        remote,
        state: getState(remote),
    }));
}

export function threadLifecycleSnapshot(input: {
    selectedConversationId?: string | null;
    composePendingDmPeer?: string | null;
    conversationKind?: string | null;
    composerDisabledReason?: string | null;
    threadEstablishingConnection?: boolean;
    threadPeersUsable?: boolean;
    threadRemoteRecipients?: readonly string[];
    connectionState?: string | null;
    presenceReady?: boolean;
    peerStates?: ThreadPeerStateRow[];
}): Record<string, unknown> {
    return {
        selectedConversationId: input.selectedConversationId
            ? shortSpaceId(input.selectedConversationId)
            : null,
        composePendingDmPeer: input.composePendingDmPeer ?? null,
        conversationKind: input.conversationKind ?? null,
        composerReady: input.composerDisabledReason == null,
        composerDisabledReason: input.composerDisabledReason ?? null,
        threadEstablishingConnection:
            input.threadEstablishingConnection ?? false,
        threadPeersUsable: input.threadPeersUsable ?? false,
        threadRemoteRecipients: input.threadRemoteRecipients ?? [],
        connectionState: input.connectionState ?? null,
        presenceReady: input.presenceReady ?? false,
        peerStates: input.peerStates ?? [],
    };
}

let globalInstalled = false;

export function installThreadLifecycleGlobal(): void {
    if (globalInstalled || typeof window === "undefined") return;
    globalInstalled = true;
    (
        window as Window & {
            __chatThreadLifecycle?: Record<string, unknown>;
        }
    ).__chatThreadLifecycle = {
        events: () => [...ring],
        clear: clearThreadLifecycleEvents,
        dump: () => JSON.stringify(ring, null, 2),
        snapshot: () => ring[ring.length - 1] ?? null,
    };
}

declare global {
    interface Window {
        __chatThreadLifecycle?: {
            events: () => readonly ThreadLifecycleEvent[];
            clear: () => void;
            dump: () => string;
            snapshot: () => ThreadLifecycleEvent | null;
        };
    }
}

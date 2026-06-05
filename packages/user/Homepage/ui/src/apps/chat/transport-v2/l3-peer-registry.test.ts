import { describe, expect, it, vi } from "vitest";

import type { ChatDataPeerHandlers } from "../lib/chat-data-webrtc-peer";
import { createPeerTransportRegistry } from "./l3-peer-registry";
import type { PeerState } from "./types";

const peerMock = vi.hoisted(() => {
    class MockChatDataWebRtcPeer {
        static created: MockChatDataWebRtcPeer[] = [];

        readonly sessionId: string;
        readonly selfAccount: string;
        readonly peerAccount: string;
        readonly handlers: ChatDataPeerHandlers;

        disposed = false;

        constructor(params: {
            sessionId: string;
            selfAccount: string;
            peerAccount: string;
            iceServers: unknown;
            signaling: unknown;
            isInitiator: boolean;
            impolite?: boolean;
            handlers?: ChatDataPeerHandlers;
        }) {
            this.sessionId = params.sessionId;
            this.selfAccount = params.selfAccount;
            this.peerAccount = params.peerAccount;
            this.handlers = params.handlers ?? {};
            MockChatDataWebRtcPeer.created.push(this);
        }

        stopMeetMedia(): void {}

        dispose(): void {
            this.disposed = true;
        }

        async handleRemoteSignal(): Promise<void> {}

        fireDataChannelOpen(): void {
            this.handlers.onDataChannelOpen?.();
        }

        fireTransportLost(): void {
            this.handlers.onTransportLost?.("transport lost");
        }

        fireFailed(): void {
            this.handlers.onFailed?.("failed");
        }
    }

    return { MockChatDataWebRtcPeer };
});

vi.mock("../lib/chat-data-webrtc-peer", () => ({
    ChatDataWebRtcPeer: peerMock.MockChatDataWebRtcPeer,
}));

function createRealtimeHarness(isReadyInitially: boolean) {
    let isReady = isReadyInitially;
    const handlers = new Map<string, Set<() => void>>();
    return {
        get isReady() {
            return isReady;
        },
        setReady(next: boolean) {
            isReady = next;
            if (next) {
                for (const h of handlers.get("ready") ?? []) h();
            }
        },
        on(event: "ready", handler: () => void) {
            const set = handlers.get(event) ?? new Set();
            set.add(handler);
            handlers.set(event, set);
            return () => set.delete(handler);
        },
    };
}

function createPairSignalingHarness() {
    const joined = new Set<string>();
    const handlers = new Set<(pairId: string) => void>();
    return {
        joinPair: vi.fn(),
        leavePair: vi.fn(),
        isJoined: (pairId: string) => joined.has(pairId),
        markJoined(pairId: string) {
            joined.add(pairId);
            for (const h of handlers) h(pairId);
        },
        on(event: "pairJoined", handler: (pairId: string) => void) {
            if (event !== "pairJoined") return () => {};
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
    };
}

describe("l3-peer-registry", () => {
    it("ensure enters waiting_ws when ws not ready, then negotiates on ready", async () => {
        peerMock.MockChatDataWebRtcPeer.created.length = 0;
        const realtime = createRealtimeHarness(false);
        const pairSignaling = createPairSignalingHarness();

        const registry = createPeerTransportRegistry({
            localAccount: "alice",
            realtime: realtime as never,
            pairSignaling: pairSignaling as never,
            signaling: {} as never,
            iceServers: null,
        });

        const ensureP = registry.ensure("bob", "peer_focus");
        expect(registry.getState("bob")).toBe("waiting_ws");
        expect(pairSignaling.joinPair).not.toHaveBeenCalled();

        realtime.setReady(true);
        expect(pairSignaling.joinPair).toHaveBeenCalledWith("alice", "bob");
        expect(registry.getState("bob")).toBe("negotiating");

        pairSignaling.markJoined("wrtc:pair:alice:bob");
        const created = peerMock.MockChatDataWebRtcPeer.created.at(-1);
        expect(created?.peerAccount).toBe("bob");

        created?.fireDataChannelOpen();
        await ensureP;
        expect(registry.getState("bob")).toBe("usable");
    });

    it("pairJoined triggers peer creation and resolves ensure waiters", async () => {
        peerMock.MockChatDataWebRtcPeer.created.length = 0;
        const realtime = createRealtimeHarness(true);
        const pairSignaling = createPairSignalingHarness();

        const registry = createPeerTransportRegistry({
            localAccount: "alice",
            realtime: realtime as never,
            pairSignaling: pairSignaling as never,
            signaling: {} as never,
            iceServers: null,
        });

        const ensureP = registry.ensure("bob", "message_enqueued");
        expect(registry.getState("bob")).toBe("negotiating");
        expect(peerMock.MockChatDataWebRtcPeer.created).toHaveLength(0);

        pairSignaling.markJoined("wrtc:pair:alice:bob");
        expect(peerMock.MockChatDataWebRtcPeer.created).toHaveLength(1);
        peerMock.MockChatDataWebRtcPeer.created[0]?.fireDataChannelOpen();
        await ensureP;
        expect(registry.getState("bob")).toBe("usable");
    });

    it("onTransportLost transitions to suspected_dead and drops peer", async () => {
        peerMock.MockChatDataWebRtcPeer.created.length = 0;
        const realtime = createRealtimeHarness(true);
        const pairSignaling = createPairSignalingHarness();
        pairSignaling.markJoined("wrtc:pair:alice:bob");

        const registry = createPeerTransportRegistry({
            localAccount: "alice",
            realtime: realtime as never,
            pairSignaling: pairSignaling as never,
            signaling: {} as never,
            iceServers: null,
        });

        const ensureP = registry.ensure("bob", "peer_focus");
        const peer = peerMock.MockChatDataWebRtcPeer.created[0]!;
        peer.fireDataChannelOpen();
        await ensureP;
        expect(registry.getState("bob")).toBe("usable");

        peer.fireTransportLost();
        expect(registry.getState("bob")).toBe("suspected_dead");
        expect(peer.disposed).toBe(true);
        expect(registry.getChatPeer("bob")).toBe(null);
    });

    it("dispose removes entry and calls leavePair", async () => {
        peerMock.MockChatDataWebRtcPeer.created.length = 0;
        const realtime = createRealtimeHarness(true);
        const pairSignaling = createPairSignalingHarness();
        pairSignaling.markJoined("wrtc:pair:alice:bob");

        const registry = createPeerTransportRegistry({
            localAccount: "alice",
            realtime: realtime as never,
            pairSignaling: pairSignaling as never,
            signaling: {} as never,
            iceServers: null,
        });

        void registry.ensure("bob", "peer_focus");
        const peer = peerMock.MockChatDataWebRtcPeer.created[0]!;
        peer.fireDataChannelOpen();
        expect(registry.getState("bob")).toBe("usable");

        registry.dispose("bob", "force");
        expect(pairSignaling.leavePair).toHaveBeenCalledWith(
            "wrtc:pair:alice:bob",
            "force",
        );
        expect(registry.getState("bob")).toBe("absent");
    });

    it("meet hold prevents idle disposal during prune", async () => {
        peerMock.MockChatDataWebRtcPeer.created.length = 0;
        vi.useFakeTimers();
        vi.setSystemTime(0);

        const realtime = createRealtimeHarness(true);
        const pairSignaling = createPairSignalingHarness();
        pairSignaling.markJoined("wrtc:pair:alice:bob");
        pairSignaling.markJoined("wrtc:pair:alice:charlie");

        const registry = createPeerTransportRegistry({
            localAccount: "alice",
            realtime: realtime as never,
            pairSignaling: pairSignaling as never,
            signaling: {} as never,
            iceServers: null,
        });

        void registry.ensure("bob", "peer_focus");
        const peerBob = peerMock.MockChatDataWebRtcPeer.created[0]!;
        peerBob.fireDataChannelOpen();
        expect(registry.getState("bob")).toBe("usable");

        registry.holdMeet("bob");

        // Advance time well past any idle TTL, then create another entry to trigger pruneIdle.
        vi.setSystemTime(10_000_000);
        void registry.ensure("charlie", "peer_focus");
        const peerCharlie = peerMock.MockChatDataWebRtcPeer.created.at(-1)!;
        peerCharlie.fireDataChannelOpen();

        expect(registry.getState("bob")).toBe("usable");
        expect(registry.getChatPeer("bob")).not.toBe(null);

        vi.useRealTimers();
    });

    it("handleRemoteSignal creates entry and forwards to peer when possible", async () => {
        peerMock.MockChatDataWebRtcPeer.created.length = 0;
        const realtime = createRealtimeHarness(true);
        const pairSignaling = createPairSignalingHarness();
        pairSignaling.markJoined("wrtc:pair:alice:bob");

        const registry = createPeerTransportRegistry({
            localAccount: "alice",
            realtime: realtime as never,
            pairSignaling: pairSignaling as never,
            signaling: {} as never,
            iceServers: null,
        });

        const spy = vi.spyOn(
            peerMock.MockChatDataWebRtcPeer.prototype,
            "handleRemoteSignal",
        );

        await registry.handleRemoteSignal("bob", {
            kind: "offer",
            sdp: "v=0 test",
        });

        expect(peerMock.MockChatDataWebRtcPeer.created).toHaveLength(1);
        expect(spy).toHaveBeenCalled();
    });

    it("buffers inbound signals until pair join creates the peer", async () => {
        peerMock.MockChatDataWebRtcPeer.created.length = 0;
        const realtime = createRealtimeHarness(true);
        const pairSignaling = createPairSignalingHarness();

        const registry = createPeerTransportRegistry({
            localAccount: "bob",
            realtime: realtime as never,
            pairSignaling: pairSignaling as never,
            signaling: {} as never,
            iceServers: null,
        });

        const spy = vi.spyOn(
            peerMock.MockChatDataWebRtcPeer.prototype,
            "handleRemoteSignal",
        );

        await registry.handleRemoteSignal("alice", {
            kind: "offer",
            sdp: "v=0 early-offer",
        });

        expect(peerMock.MockChatDataWebRtcPeer.created).toHaveLength(0);
        expect(spy).not.toHaveBeenCalled();

        pairSignaling.markJoined("wrtc:pair:alice:bob");

        expect(peerMock.MockChatDataWebRtcPeer.created).toHaveLength(1);
        expect(spy).toHaveBeenCalledWith({
            kind: "offer",
            sdp: "v=0 early-offer",
        });
    });

    it("forwards signals directly when peer already exists", async () => {
        peerMock.MockChatDataWebRtcPeer.created.length = 0;
        const realtime = createRealtimeHarness(true);
        const pairSignaling = createPairSignalingHarness();
        pairSignaling.markJoined("wrtc:pair:alice:bob");

        const registry = createPeerTransportRegistry({
            localAccount: "alice",
            realtime: realtime as never,
            pairSignaling: pairSignaling as never,
            signaling: {} as never,
            iceServers: null,
        });

        const spy = vi.spyOn(
            peerMock.MockChatDataWebRtcPeer.prototype,
            "handleRemoteSignal",
        );

        await registry.handleRemoteSignal("bob", {
            kind: "offer",
            sdp: "v=0 first",
        });
        spy.mockClear();

        await registry.handleRemoteSignal("bob", {
            kind: "candidate",
            candidate: "candidate:1",
        });

        expect(spy).toHaveBeenCalledWith({
            kind: "candidate",
            candidate: "candidate:1",
        });
    });

    it("ensure state remains stable for unknown remote", () => {
        const realtime = createRealtimeHarness(true);
        const pairSignaling = createPairSignalingHarness();
        const registry = createPeerTransportRegistry({
            localAccount: "alice",
            realtime: realtime as never,
            pairSignaling: pairSignaling as never,
            signaling: {} as never,
            iceServers: null,
        });

        const state: PeerState = registry.getState("nobody");
        expect(state).toBe("absent");
    });
});


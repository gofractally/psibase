import type { RealtimeHandlers } from "../lib/realtime-client";
import type {
    ClientRealtimeFrame,
    ServerRealtimeFrame,
} from "../lib/realtime-protocol";
import { createChatTransportStack, type ChatTransportStack } from "./stack";
import { pairSessionId } from "./pair-id";

/** Minimal fake websocket client for stack integration tests. */
export class FakeRealtimeClient {
    readonly instanceId: string;

    user: string;

    welcomeGeneration = 1;

    isSessionReady = true;

    handlers: RealtimeHandlers = {};

    sentFrames: ClientRealtimeFrame[] = [];

    onSend: ((frame: ClientRealtimeFrame) => void) | null = null;

    constructor(user: string, instanceId?: string) {
        this.user = user;
        this.instanceId = instanceId ?? `rt-${user}`;
    }

    registerHandlers(extra: RealtimeHandlers): void {
        this.handlers = { ...this.handlers, ...extra };
    }

    sendClientFrame(frame: ClientRealtimeFrame): void {
        this.sentFrames.push(frame);
        this.onSend?.(frame);
    }

    isReconnectWelcome(): boolean {
        return this.welcomeGeneration > 1;
    }

    connect(): void {
        this.dispatch({
            t: "welcome",
            user: this.user,
            serverTime: Date.now() * 1000,
            iceServers: [],
        });
    }

    simulateReconnectWelcome(): void {
        this.welcomeGeneration += 1;
        this.connect();
    }

    dispatch(frame: ServerRealtimeFrame): void {
        const handler = (this.handlers as Record<string, unknown>)[frame.t];
        if (typeof handler === "function") {
            (handler as (f: ServerRealtimeFrame) => void)(frame);
        }
    }

    close(): void {
        /* noop */
    }
}

/** In-memory pair-session roster + signal relay (no chain). */
export class PairSessionHub {
    private readonly clients = new Map<string, FakeRealtimeClient>();

    private readonly pairRoster = new Map<string, Set<string>>();

    register(account: string, client: FakeRealtimeClient): void {
        client.onSend = (frame) => this.handleSend(account, frame);
        this.clients.set(account, client);
    }

    setPresence(account: string, online: boolean): void {
        for (const client of this.clients.values()) {
            client.dispatch({
                t: "presence",
                account,
                status: online ? "online" : "offline",
            });
        }
    }

    private handleSend(from: string, frame: ClientRealtimeFrame): void {
        if (
            frame.t === "joinSession" &&
            frame.sessionId.startsWith("wrtc:pair:")
        ) {
            const roster =
                this.pairRoster.get(frame.sessionId) ?? new Set<string>();
            roster.add(from);
            this.pairRoster.set(frame.sessionId, roster);
            this.broadcastSnapshot(frame.sessionId);
            return;
        }

        if (frame.t === "signal") {
            const target = this.clients.get(frame.to);
            if (!target) return;
            target.dispatch({
                t: "signal",
                sessionId: frame.sessionId,
                from,
                to: frame.to,
                kind: frame.kind,
                sdp: frame.sdp,
                candidate: frame.candidate,
                sdpMid: frame.sdpMid,
                sdpMLineIndex: frame.sdpMLineIndex,
            });
        }
    }

    private broadcastSnapshot(pairId: string): void {
        const joined = [...(this.pairRoster.get(pairId) ?? [])].sort();
        const epoch = joined.length;
        for (const account of joined) {
            this.clients.get(account)?.dispatch({
                t: "sessionSnapshot",
                sessionId: pairId,
                joinedParticipants: joined,
                pendingParticipants: [],
                epoch,
            });
        }
    }

    joinCount(pairId: string): number {
        return this.pairRoster.get(pairId)?.size ?? 0;
    }
}

export type StackFixture = {
    account: string;
    rt: FakeRealtimeClient;
    stack: ChatTransportStack;
};

export function createStackFixture(
    hub: PairSessionHub,
    account: string,
    chainId = "test-chain",
    onInboundBytes?: (remote: string, bytes: Uint8Array) => void,
): StackFixture {
    const rt = new FakeRealtimeClient(account);
    hub.register(account, rt);
    const stack = createChatTransportStack({
        localAccount: account,
        chainId,
        realtimeClient: rt,
        iceServers: null,
        onInboundBytes,
    });
    stack.wireRealtimeHandlers({});
    rt.connect();
    return { account, rt, stack };
}

export function pairIdFor(a: string, b: string): string {
    return pairSessionId(a, b);
}

/** Bring both sides of a pair to `usable` via join + sessionSnapshot. */
export async function establishPair(
    hub: PairSessionHub,
    alice: StackFixture,
    bob: StackFixture,
): Promise<void> {
    hub.setPresence(alice.account, true);
    hub.setPresence(bob.account, true);
    await alice.stack.peerRegistry.ensure(bob.account, "peer_focus");
    await bob.stack.peerRegistry.ensure(alice.account, "peer_focus");
}

export function createTwoPartyHub(): PairSessionHub {
    return new PairSessionHub();
}

export function createTwoPartyStacks(
    hub: PairSessionHub,
    opts?: {
        onAliceInbound?: (remote: string, bytes: Uint8Array) => void;
        onBobInbound?: (remote: string, bytes: Uint8Array) => void;
    },
): { alice: StackFixture; bob: StackFixture; hub: PairSessionHub } {
    const alice = createStackFixture(hub, "alice", "chain-a", opts?.onAliceInbound);
    const bob = createStackFixture(hub, "bob", "chain-b", opts?.onBobInbound);
    return { alice, bob, hub };
}

export function createThreePartyStacks(
    hub: PairSessionHub,
    opts?: {
        onAliceInbound?: (remote: string, bytes: Uint8Array) => void;
        onBobInbound?: (remote: string, bytes: Uint8Array) => void;
        onCharlieInbound?: (remote: string, bytes: Uint8Array) => void;
    },
): {
    alice: StackFixture;
    bob: StackFixture;
    charlie: StackFixture;
    hub: PairSessionHub;
} {
    const alice = createStackFixture(
        hub,
        "alice",
        "chain-a",
        opts?.onAliceInbound,
    );
    const bob = createStackFixture(hub, "bob", "chain-b", opts?.onBobInbound);
    const charlie = createStackFixture(
        hub,
        "charlie",
        "chain-c",
        opts?.onCharlieInbound,
    );
    return { alice, bob, charlie, hub };
}

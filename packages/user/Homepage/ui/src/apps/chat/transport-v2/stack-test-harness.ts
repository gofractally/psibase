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

    registerHandlers(extra: RealtimeHandlers): () => void {
        type HandlerFn = (frame: ServerRealtimeFrame) => void;
        const added: Array<[keyof RealtimeHandlers, HandlerFn]> = [];
        for (const key of Object.keys(extra) as (keyof RealtimeHandlers)[]) {
            const next = extra[key] as HandlerFn | undefined;
            if (!next) continue;
            const existing = this.handlers[key as keyof RealtimeHandlers] as
                | HandlerFn
                | undefined;
            if (existing) {
                this.handlers[key as keyof RealtimeHandlers] = ((frame) => {
                    existing(frame);
                    next(frame);
                }) as never;
            } else {
                this.handlers[key as keyof RealtimeHandlers] = next as never;
            }
            added.push([key, next]);
        }
        return () => {
            for (const [key, removed] of added) {
                const current = this.handlers[key as keyof RealtimeHandlers] as
                    | HandlerFn
                    | undefined;
                if (current === removed) {
                    delete this.handlers[key as keyof RealtimeHandlers];
                }
            }
        };
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
    private readonly clientsByAccount = new Map<string, FakeRealtimeClient[]>();

    /** Which client instance joined each pair session for an account. */
    private readonly joinClient = new Map<string, FakeRealtimeClient>();

    private readonly pairRoster = new Map<string, Set<string>>();

    register(account: string, client: FakeRealtimeClient): void {
        client.onSend = (frame) => this.handleSend(account, client, frame);
        const list = this.clientsByAccount.get(account) ?? [];
        list.push(client);
        this.clientsByAccount.set(account, list);
    }

    setPresence(account: string, online: boolean): void {
        for (const clients of this.clientsByAccount.values()) {
            for (const client of clients) {
                client.dispatch({
                    t: "presence",
                    account,
                    status: online ? "online" : "offline",
                });
            }
        }
    }

    private joinKey(sessionId: string, account: string): string {
        return `${sessionId}\0${account}`;
    }

    private handleSend(
        from: string,
        client: FakeRealtimeClient,
        frame: ClientRealtimeFrame,
    ): void {
        if (
            frame.t === "joinSession" &&
            frame.sessionId.startsWith("wrtc:pair:")
        ) {
            const roster =
                this.pairRoster.get(frame.sessionId) ?? new Set<string>();
            roster.add(from);
            this.pairRoster.set(frame.sessionId, roster);
            this.joinClient.set(
                this.joinKey(frame.sessionId, from),
                client,
            );
            this.broadcastSnapshot(frame.sessionId);
            return;
        }

        if (frame.t === "signal") {
            const targetClient = this.joinClient.get(
                this.joinKey(frame.sessionId, frame.to),
            );
            if (!targetClient) return;
            targetClient.dispatch({
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
            const client = this.joinClient.get(this.joinKey(pairId, account));
            client?.dispatch({
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
    const rt = new FakeRealtimeClient(account, `${account}-primary`);
    hub.register(account, rt);
    const stack = createChatTransportStack({
        localAccount: account,
        chainId,
        realtimeClient: rt,
        iceServers: null,
        onInboundBytes,
        pairJoinStaggerMs: 0,
        pairJoinRetryMs: 0,
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
    await Promise.all([
        alice.stack.peerRegistry.ensure(bob.account, "peer_focus"),
        bob.stack.peerRegistry.ensure(alice.account, "peer_focus"),
    ]);
    await Promise.resolve();
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

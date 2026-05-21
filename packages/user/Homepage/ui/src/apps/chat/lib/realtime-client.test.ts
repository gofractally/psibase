import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RealtimeClient } from "./realtime-client";

const WELCOME = JSON.stringify({
    t: "welcome",
    user: "alice",
    serverTime: 1,
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
});

async function flushAsync(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

class MockWebSocket {
    static CONNECTING = 0;

    static OPEN = 1;

    static CLOSING = 2;

    static CLOSED = 3;

    static instances: MockWebSocket[] = [];

    readyState = MockWebSocket.CONNECTING;

    url: string;

    protocols: string[];

    onopen: ((ev: Event) => void) | null = null;

    onmessage: ((ev: MessageEvent) => void) | null = null;

    onerror: ((ev: Event) => void) | null = null;

    onclose: ((ev: CloseEvent) => void) | null = null;

    sent: string[] = [];

    constructor(url: string, protocols?: string | string[]) {
        this.url = url;
        this.protocols = protocols
            ? Array.isArray(protocols)
                ? protocols
                : [protocols]
            : [];
        MockWebSocket.instances.push(this);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        if (this.readyState === MockWebSocket.CLOSED) return;
        this.readyState = MockWebSocket.CLOSED;
        queueMicrotask(() => this.onclose?.({} as CloseEvent));
    }

    /** Synchronous close callback (superseded socket after a newer connect). */
    emitClose(): void {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({} as CloseEvent);
    }

    open(): void {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.({} as Event);
    }

    message(text: string): void {
        this.onmessage?.({ data: text } as MessageEvent);
    }
}

function installMockWebSocket(): void {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
}

describe("RealtimeClient reconnect", () => {
    beforeEach(() => {
        MockWebSocket.instances = [];
        installMockWebSocket();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function makeClient(
        overrides: ConstructorParameters<typeof RealtimeClient>[0] = {},
    ): RealtimeClient {
        return new RealtimeClient({
            baseUrl: "https://test.localhost:8080",
            authTokenProvider: async () => "test-token",
            reconnect: { initialDelayMs: 100, maxDelayMs: 100 },
            ...overrides,
        });
    }

    async function connectThroughWelcome(client: RealtimeClient): Promise<MockWebSocket> {
        client.connect();
        await flushAsync();
        const ws = MockWebSocket.instances.at(-1)!;
        ws.open();
        ws.message(WELCOME);
        return ws;
    }

    it("isReconnectWelcome is false on first welcome and true after a later welcome", () => {
        const client = makeClient();

        client.receive(WELCOME);
        expect(client.isReconnectWelcome()).toBe(false);
        expect(client.isSessionReady).toBe(true);
        expect(client.state).toBe("connected");

        client.receive(WELCOME);
        expect(client.isReconnectWelcome()).toBe(true);
    });

    it("resets welcomeCount when the client is closed", () => {
        const client = makeClient();
        client.receive(WELCOME);
        client.receive(WELCOME);
        expect(client.isReconnectWelcome()).toBe(true);

        client.close();
        expect(client.isReconnectWelcome()).toBe(false);
        expect(client.state).toBe("offline");
    });

    it("does not schedule reconnect when a superseded socket closes after reconnectNow", async () => {
        const stateChanges: string[] = [];
        const client = makeClient({
            onState: (state) => stateChanges.push(state),
        });

        const ws1 = await connectThroughWelcome(client);
        expect(client.isReconnectWelcome()).toBe(false);

        client.reconnectNow();
        await flushAsync();

        const ws2 = MockWebSocket.instances.at(-1)!;
        expect(ws2).not.toBe(ws1);
        ws2.open();
        ws2.message(WELCOME);

        expect(client.isReconnectWelcome()).toBe(true);
        expect(client.state).toBe("connected");

        const reconnectingCountBefore = stateChanges.filter(
            (s) => s === "reconnecting",
        ).length;

        await flushAsync();

        vi.advanceTimersByTime(500);

        expect(client.state).toBe("connected");
        expect(
            stateChanges.filter((s) => s === "reconnecting").length,
        ).toBe(reconnectingCountBefore);
        expect(MockWebSocket.instances).toHaveLength(2);
    });

    it("does not schedule reconnect when a superseded socket emits a late onclose", async () => {
        const client = makeClient();

        const ws1 = await connectThroughWelcome(client);
        client.reconnectNow();
        await flushAsync();

        const ws2 = MockWebSocket.instances.at(-1)!;
        ws2.open();
        ws2.message(WELCOME);
        expect(client.isReconnectWelcome()).toBe(true);

        ws1.emitClose();
        vi.advanceTimersByTime(500);

        expect(client.state).toBe("connected");
        expect(MockWebSocket.instances).toHaveLength(2);
    });

    it("schedules reconnect when the active socket closes unexpectedly", async () => {
        const client = makeClient();
        const ws = await connectThroughWelcome(client);
        expect(client.state).toBe("connected");

        ws.emitClose();
        expect(client.state).toBe("reconnecting");

        await vi.advanceTimersByTimeAsync(100);
        await flushAsync();

        expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    });

    /**
     * F3: WS health watchdog. Without it, a half-open WS can silently swallow
     * pings/pongs without close events firing, and the client stays
     * "connected" while every signal it sends drops on the floor. The fix is
     * an app-level liveness check: if no frame arrives within the deadline
     * after a ping, force-reconnect.
     */
    it("force-reconnects when no inbound frame arrives within the pong deadline", async () => {
        const client = makeClient({
            health: { pingIntervalMs: 1000, pongTimeoutMs: 2000 },
        });
        const ws = await connectThroughWelcome(client);
        expect(client.state).toBe("connected");

        // Tick to first ping. Server is silent (half-open ws).
        await vi.advanceTimersByTimeAsync(1000);
        await flushAsync();
        const pingsSent = ws.sent.filter((s) => s.includes('"t":"ping"'));
        expect(pingsSent.length).toBeGreaterThanOrEqual(1);

        // Pong deadline expires → force-reconnect.
        await vi.advanceTimersByTimeAsync(2000);
        await flushAsync();
        expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    });

    it("does not trip the watchdog when inbound frames keep arriving", async () => {
        const client = makeClient({
            health: { pingIntervalMs: 1000, pongTimeoutMs: 2000 },
        });
        const ws = await connectThroughWelcome(client);

        // Every ping interval, server sends a pong before the deadline.
        for (let i = 0; i < 3; i++) {
            await vi.advanceTimersByTimeAsync(1000);
            ws.message(JSON.stringify({ t: "pong" }));
            await flushAsync();
        }

        // After 3 healthy cycles + extra slack we should still only have one
        // socket — the watchdog should never have forced a reconnect.
        await vi.advanceTimersByTimeAsync(500);
        expect(MockWebSocket.instances).toHaveLength(1);
        expect(client.state).toBe("connected");
    });

    it("connects to x-webrtcsig subdomain (not invalid x-webrtc-sig account name)", async () => {
        const client = makeClient({
            baseUrl: "https://network.psibase.localhost:8080/",
        });
        client.connect();
        await flushAsync();
        const ws = MockWebSocket.instances.at(-1)!;
        expect(ws.url).toBe("wss://x-webrtcsig.psibase.localhost:8080/ws");
        expect(ws.url).not.toContain("x-webrtc-sig");
    });
});

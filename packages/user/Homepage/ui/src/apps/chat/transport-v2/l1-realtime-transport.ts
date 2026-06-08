import type { RealtimeClient } from "../lib/realtime-client";
import type {
    ClientRealtimeFrame,
    ServerRealtimeFrame,
} from "../lib/realtime-protocol";
import { EventBus } from "./event-bus";
import type { Unsubscribe } from "./types";

type RealtimeTransportEvents = {
    ready: () => void;
    welcome: (generation: number, reconnect: boolean) => void;
    closed: () => void;
    presence: (account: string, online: boolean) => void;
};

export interface RealtimeTransport {
    connect(): void;
    close(): void;
    dispose(): void;
    readonly isReady: boolean;
    readonly welcomeGeneration: number;
    on(
        event: keyof RealtimeTransportEvents,
        handler: RealtimeTransportEvents[keyof RealtimeTransportEvents],
    ): Unsubscribe;
    send(frame: ClientRealtimeFrame): void;
    isRecipientOnline(account: string): boolean;
}

export function createRealtimeTransport(
    client: RealtimeClient,
    initialPresence?: ReadonlyMap<string, boolean>,
): RealtimeTransport {
    const bus = new EventBus<RealtimeTransportEvents>();
    const presence = new Map<string, boolean>(initialPresence);

    let lastWelcomeGen = client.welcomeGeneration;

    const dispatchPresence = (account: string, online: boolean) => {
        presence.set(account, online);
        bus.emit("presence", account, online);
    };

    const unregisterClientHandlers = client.registerHandlers({
        welcome: () => {
            const reconnect = client.isReconnectWelcome();
            lastWelcomeGen = client.welcomeGeneration;
            bus.emit("welcome", lastWelcomeGen, reconnect);
            if (client.isSessionReady) {
                bus.emit("ready");
            }
        },
        presenceSnapshot: (frame) => {
            for (const entry of frame.contacts) {
                dispatchPresence(entry.account, entry.presence === "online");
            }
        },
        presence: (frame) => {
            dispatchPresence(frame.account, frame.status === "online");
        },
    });

    const originalOnFrame = client as RealtimeClient & {
        _transportWrapped?: boolean;
    };
    if (!originalOnFrame._transportWrapped) {
        originalOnFrame._transportWrapped = true;
    }

    return {
        connect: () => client.connect(),
        close: () => client.close(),
        dispose: () => {
            unregisterClientHandlers();
        },
        get isReady() {
            return client.isSessionReady;
        },
        get welcomeGeneration() {
            return client.welcomeGeneration;
        },
        on(event, handler) {
            return bus.on(event, handler as RealtimeTransportEvents[typeof event]);
        },
        send(frame) {
            client.sendClientFrame(frame);
        },
        isRecipientOnline(account) {
            return presence.get(account) === true;
        },
    };
}

export type { RealtimeTransportEvents, ServerRealtimeFrame };

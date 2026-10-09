import { openServiceWebSocket, Supervisor } from "@psibase/common-lib";

import {
    BATTLEZONE_SUBPROTOCOL_V1,
    type ClientFrame,
    type ServerFrame,
} from "./protocol";

export type RealtimeHandlers = {
    onFrame: (frame: ServerFrame) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (err: string) => void;
};

export class BattlezoneRealtime {
    private ws: WebSocket | null = null;
    private handlers: RealtimeHandlers;

    constructor(handlers: RealtimeHandlers) {
        this.handlers = handlers;
    }

    async connect(): Promise<void> {
        this.close();

        const ws = await openServiceWebSocket("x-bzone", "/ws", [
            BATTLEZONE_SUBPROTOCOL_V1,
        ]);
        this.ws = ws;

        ws.onopen = () => {
            this.send({ t: "hello" });
            this.handlers.onOpen?.();
        };
        ws.onmessage = (ev) => {
            try {
                const frame = JSON.parse(String(ev.data)) as ServerFrame;
                this.handlers.onFrame(frame);
            } catch {
                this.handlers.onError?.("bad server frame");
            }
        };
        ws.onerror = () => {
            this.handlers.onError?.("websocket error");
        };
        ws.onclose = () => {
            this.handlers.onClose?.();
        };
    }

    send(frame: ClientFrame): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify(frame));
    }

    close(): void {
        if (this.ws) {
            const ws = this.ws;
            this.ws = null;
            try {
                ws.close(1000, "leave");
            } catch {
                // ignore
            }
        }
    }

    get connected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}

export async function ensureLoggedIn(
    supervisor: Supervisor,
): Promise<string | null> {
    try {
        const user = (await supervisor.functionCall({
            service: "accounts",
            plugin: "query",
            intf: "api",
            method: "getCurrentUser",
            params: [],
        })) as string | null;
        if (user) return user;

        await supervisor.functionCall(
            {
                service: "accounts",
                plugin: "plugin",
                intf: "activeApp",
                method: "connectAccount",
                params: [],
            },
            { enabled: true, returnPath: "/" },
        );

        return (await supervisor.functionCall({
            service: "accounts",
            plugin: "query",
            intf: "api",
            method: "getCurrentUser",
            params: [],
        })) as string | null;
    } catch {
        return null;
    }
}

import type { Page, WebSocket as PWWebSocket } from "@playwright/test";

import { test, expect } from "../fixtures/chain";
import { loginProducerViaUi, PRODUCER_ACCOUNT } from "../lib/auth-ui";
import { openChat } from "../lib/chat-ui";
import { attachDiagnostics } from "../lib/diagnostics";

/**
 * Micro-reproduction for the "Reconnecting…" WS storm after re-opening Chat.
 *
 * Boots a chain, logs in the producer, opens Chat once, navigates away, opens
 * Chat again, then watches every x-webrtcsig WebSocket for ~5 seconds. If the
 * WS is healthy we expect at most a tiny number of opens/closes (one per
 * navigation). If the storm reproduces we'll see dozens.
 */

type WsEvent = {
    relMs: number;
    kind: "open" | "close" | "tx" | "rx";
    payload?: string;
};

const SIG_WS = /x-webrtcsig\.psibase\.localhost.*\/ws$/;

function attachSigWsRecorder(
    page: Page,
    label: string,
    recorder: WsEvent[],
    startedAt: { value: number },
): void {
    attachDiagnostics(page, label, {
        consoleFilter: /realtime|x-webrtcsig|chat-data|websocket/i,
        websocket: false,
    });
    page.on("websocket", (ws: PWWebSocket) => {
        if (!SIG_WS.test(ws.url())) return;
        const open = (kind: WsEvent["kind"], payload?: string): void => {
            recorder.push({ relMs: Date.now() - startedAt.value, kind, payload });
        };
        open("open");
        ws.on("close", () => open("close"));
        ws.on("framesent", (frame) => {
            const text =
                typeof frame.payload === "string"
                    ? frame.payload
                    : frame.payload.toString("utf8");
            open("tx", text.slice(0, 160));
        });
        ws.on("framereceived", (frame) => {
            const text =
                typeof frame.payload === "string"
                    ? frame.payload
                    : frame.payload.toString("utf8");
            open("rx", text.slice(0, 160));
        });
    });
}

test.describe("Chat realtime WS survives re-navigation", () => {
    test("only one healthy x-webrtcsig WS exists at any time across chat ↔ home re-navigation", async ({
        chain,
        alicePage,
    }) => {
        const recorder: WsEvent[] = [];
        const startedAt = { value: Date.now() };
        attachSigWsRecorder(alicePage, "alice", recorder, startedAt);

        await loginProducerViaUi(alicePage, PRODUCER_ACCOUNT, chain.baseUrl);
        await openChat(alicePage, chain.baseUrl);
        await alicePage.waitForTimeout(3_000);

        await alicePage.goto(chain.baseUrl, { waitUntil: "domcontentloaded" });
        await alicePage.waitForTimeout(1_000);
        await openChat(alicePage, chain.baseUrl);
        await alicePage.waitForTimeout(8_000);

        // Print the timeline so the diagnostic value survives even on failure.
        console.log("\n[ws timeline] start ↓");
        for (const ev of recorder) {
            console.log(
                `  +${ev.relMs.toString().padStart(5, " ")}ms ${ev.kind}` +
                    (ev.payload ? ` ${ev.payload}` : ""),
            );
        }
        console.log("[ws timeline] end ↑\n");

        // Healthy upper bound: 2 opens (one per chat mount), each followed by
        // a single close at navigation. The storm produces tens-to-hundreds.
        const opens = recorder.filter((e) => e.kind === "open").length;
        const closes = recorder.filter((e) => e.kind === "close").length;
        expect(opens, "x-webrtcsig WS open count").toBeLessThanOrEqual(4);
        expect(closes, "x-webrtcsig WS close count").toBeLessThanOrEqual(4);

        // After the second openChat, the latest WS should still be alive 8s
        // later (no close after the last open).
        const lastEvent = recorder[recorder.length - 1];
        expect(
            lastEvent && lastEvent.kind !== "close",
            `last ws event was a close at +${lastEvent?.relMs}ms (storm symptom)`,
        ).toBeTruthy();
    });
});

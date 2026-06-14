import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

export type AttachDiagnosticsOptions = {
    /** Regex or string tested against console message text. */
    consoleFilter?: RegExp | string;
    /** Log websocket open/close/frame events. Default true. */
    websocket?: boolean;
    /** Log HTTP responses with status >= 400. Default true. */
    httpErrors?: boolean;
    /** Log requestfailed events. Default true. */
    requestFailed?: boolean;
    /** Log pageerror events. Default true. */
    pageErrors?: boolean;
    /** Max characters per websocket frame payload. Default 240. */
    wsFrameMaxLen?: number;
    /** Max characters per console line. Default 400. */
    consoleMaxLen?: number;
};

const DEFAULT_CONSOLE_FILTER =
    /chat-data|realtime|x-pslack|x-webrtcsig|websocket|auth|connect|reconnect|presence|signaling|peer|teardown|leaveSession|endPlaceholderCall|\[av-call\]/i;

/**
 * Stream filtered console, page errors, HTTP failures, and websocket frames from
 * a Playwright page to the test runner stdout (for E2E triage).
 */
export function attachDiagnostics(
    page: Page,
    label: string,
    options: AttachDiagnosticsOptions = {},
): void {
    const startedAt = Date.now();
    const ts = () =>
        `[${label} +${(Date.now() - startedAt).toString().padStart(5, " ")}ms]`;

    const consoleFilter = options.consoleFilter ?? DEFAULT_CONSOLE_FILTER;
    const wsFrameMaxLen = options.wsFrameMaxLen ?? 240;
    const consoleMaxLen = options.consoleMaxLen ?? 400;
    const logWs = options.websocket !== false;
    const logHttpErrors = options.httpErrors !== false;
    const logRequestFailed = options.requestFailed !== false;
    const logPageErrors = options.pageErrors !== false;

    const matchesConsole = (text: string): boolean => {
        if (typeof consoleFilter === "string") {
            return text.includes(consoleFilter);
        }
        return consoleFilter.test(text);
    };

    page.on("console", (msg) => {
        const text = msg.text();
        if (!matchesConsole(text)) return;
        const truncated =
            text.length > consoleMaxLen
                ? `${text.slice(0, consoleMaxLen)}…`
                : text;
        console.log(`${ts()} [console:${msg.type()}] ${truncated}`);
    });

    if (logPageErrors) {
        page.on("pageerror", (err) => {
            console.log(`${ts()} [pageerror] ${err.message}`);
        });
    }

    if (logRequestFailed) {
        page.on("requestfailed", (req) => {
            console.log(
                `${ts()} [requestfailed] ${req.method()} ${req.url()} -> ${
                    req.failure()?.errorText ?? "unknown"
                }`,
            );
        });
    }

    if (logHttpErrors) {
        page.on("response", (res) => {
            if (res.status() >= 400) {
                console.log(
                    `${ts()} [http ${res.status()}] ${res.request().method()} ${res.url()}`,
                );
            }
        });
    }

    if (logWs) {
        page.on("websocket", (ws) => {
            console.log(`${ts()} [ws-open] ${ws.url()}`);
            ws.on("close", () => console.log(`${ts()} [ws-close] ${ws.url()}`));
            ws.on("socketerror", (err) =>
                console.log(`${ts()} [ws-error] ${ws.url()} ${err}`),
            );
            ws.on("framesent", (f) => {
                const text =
                    typeof f.payload === "string"
                        ? f.payload
                        : f.payload.toString("utf8");
                console.log(`${ts()} [ws-tx] ${text.slice(0, wsFrameMaxLen)}`);
            });
            ws.on("framereceived", (f) => {
                const text =
                    typeof f.payload === "string"
                        ? f.payload
                        : f.payload.toString("utf8");
                console.log(`${ts()} [ws-rx] ${text.slice(0, wsFrameMaxLen)}`);
            });
        });
    }
}

const SNAPSHOT_DIR =
    process.env.PSIBASE_E2E_SNAPSHOT_DIR ??
    join(process.cwd(), "e2e", "snapshots");

/** Write a labeled full-page PNG under e2e/snapshots/ (path logged to stdout). */
export async function snapshotStep(
    page: Page,
    label: string,
): Promise<string> {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const safe = label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
    const file = join(SNAPSHOT_DIR, `${Date.now()}-${safe}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`[snapshot] ${file}`);
    return file;
}

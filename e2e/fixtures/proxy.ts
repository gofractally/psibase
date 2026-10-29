import http from "node:http";
import { HARNESS_HTML } from "./harness-page";

/**
 * Per-worker HTTP front door for the browser. It:
 *  - serves the test harness page at /__e2e/harness.html (on any subdomain),
 *  - serves /__e2e/sleep?ms=N&tag=T: waits N ms, then returns JSON with server
 *    start/end timestamps. This is the "sleep-and-timestamp" fixture: it lets
 *    tests prove (or disprove) that fetches overlap without any real network.
 *  - forwards everything else to this worker's psinode, Host header intact.
 */
export interface SleepRecord {
    tag: string;
    ms: number;
    start: number;
    end: number;
}

export interface E2eProxy {
    port: number;
    sleeps: SleepRecord[];
    /** Tags of /__e2e/sleep requests the server has received but not answered. */
    inflight: Set<string>;
    close: () => Promise<void>;
}

function cors(req: http.IncomingMessage, res: http.ServerResponse) {
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
    } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

export function startProxy(port: number, psinodePort: number): Promise<E2eProxy> {
    const sleeps: SleepRecord[] = [];
    const inflight = new Set<string>();
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://x");
        if (url.pathname.startsWith("/__e2e/")) {
            cors(req, res);
            if (req.method === "OPTIONS") return void res.writeHead(204).end();
            if (url.pathname === "/__e2e/harness.html") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                return void res.end(HARNESS_HTML);
            }
            if (url.pathname === "/__e2e/sleep") {
                const ms = Number(url.searchParams.get("ms") ?? "0");
                const tag = url.searchParams.get("tag") ?? "";
                const start = Date.now();
                inflight.add(tag);
                setTimeout(() => {
                    inflight.delete(tag);
                    const rec = { tag, ms, start, end: Date.now() };
                    sleeps.push(rec);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(rec));
                }, ms);
                return;
            }
            return void res.writeHead(404).end();
        }
        const upstream = http.request(
            { host: "127.0.0.1", port: psinodePort, method: req.method, path: req.url, headers: req.headers },
            (up) => {
                res.writeHead(up.statusCode ?? 502, up.headers);
                up.pipe(res);
            },
        );
        upstream.on("error", (e) => {
            if (!res.headersSent) res.writeHead(502);
            res.end(String(e));
        });
        req.pipe(upstream);
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () =>
            resolve({
                port,
                sleeps,
                inflight,
                close: () =>
                    new Promise<void>((r) => {
                        server.closeAllConnections();
                        server.close(() => r());
                    }),
            }),
        );
    });
}

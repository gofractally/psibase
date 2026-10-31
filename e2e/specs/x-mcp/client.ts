import http from "node:http";
import type { Devnet } from "../../fixtures/devnet";

export const V2026 = "2026-07-28";

/**
 * Raw HTTP to `<sub>.<root>` through this worker's proxy. Like devnet.get, it
 * connects to 127.0.0.1 with a Host header, so *.localhost never hits DNS or
 * an outbound HTTP proxy.
 */
export function raw(devnet: Devnet, sub: string, method: string, path: string, body?: string, headers: Record<string, string> = {}) {
    const port = Number(devnet.rootHost.split(":")[1]);
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }>((resolve, reject) => {
        const req = http.request(
            { host: "127.0.0.1", port, method, path, headers: { Host: `${sub}.${devnet.rootHost}`, ...headers } },
            (res) => {
                let text = "";
                res.setEncoding("utf8");
                res.on("data", (c) => (text += c));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
            },
        );
        req.on("error", reject);
        if (body !== undefined) req.write(body);
        req.end();
    });
}

/** POST one JSON-RPC message to the X-MCP endpoint at x-mcp.<root>/. */
export async function mcpPost(devnet: Devnet, body: Record<string, unknown>, headers: Record<string, string> = {}) {
    const r = await raw(devnet, "x-mcp", "POST", "/", JSON.stringify(body), {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
    });
    return { status: r.status, headers: r.headers, json: r.text ? JSON.parse(r.text) : undefined };
}

/** 2026-07-28 request with the required headers derived from the body. */
export function v2026(devnet: Devnet, id: number, method: string, params: Record<string, unknown> = {}) {
    const headers: Record<string, string> = { "MCP-Protocol-Version": V2026, "Mcp-Method": method };
    if (typeof params.name === "string") headers["Mcp-Name"] = params.name;
    return mcpPost(devnet, { jsonrpc: "2.0", id, method, params: { ...params, _meta: { protocolVersion: V2026 } } }, headers);
}

export async function callTool(devnet: Devnet, name: string, args: unknown) {
    const r = await v2026(devnet, 1, "tools/call", { name, arguments: args });
    if (r.status !== 200 || r.json?.result?.isError) throw new Error(`${name}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.result.structuredContent;
}

import { socketRequest } from "./socket-request";

const ADMIN_HOST = "x-admin.psibase.localhost";
const POLL_MS = 250;

async function poll(
    what: string,
    timeoutMs: number,
    ready: () => Promise<boolean>,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await ready()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
}

/**
 * Head block number, or null while the node has no chain to report one from.
 */
async function headBlock(socketPath: string): Promise<number | null> {
    const response = await socketRequest({
        socketPath,
        host: "explorer.psibase.localhost",
        path: "/graphql",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            query: "{ blocks(last:1) { edges { node { header { blockNum } } } } }",
        }),
    });
    if (response.statusCode !== 200) {
        return null;
    }
    const body = JSON.parse(response.body) as {
        data?: {
            blocks: { edges: { node: { header: { blockNum: number } } }[] };
        };
    };
    const edges = body.data?.blocks.edges ?? [];
    return edges.length === 0 ? null : edges[0].node.header.blockNum;
}

/**
 * Resolves once the node reports a chain: `needgenesis` is gone from
 * `/native/admin/status`, whether it booted the chain itself or adopted one
 * from a peer.
 */
export function waitForChain(
    socketPath: string,
    timeoutMs: number,
): Promise<void> {
    return poll(`${socketPath} to report a chain`, timeoutMs, async () => {
        const response = await socketRequest({
            socketPath,
            host: ADMIN_HOST,
            path: "/native/admin/status",
        });
        if (response.statusCode !== 200) {
            return false;
        }
        const status = JSON.parse(response.body) as string[];
        return !status.includes("needgenesis");
    });
}

/**
 * Resolves once a node has replayed everything `from` had at the time of the
 * call. Clearing `needgenesis` only means the first block landed: a node that
 * has just joined serves 404s for the services and plugin wasm the admin UI
 * reads until the boot blocks are through.
 */
export async function waitForSync(
    socketPath: string,
    from: string,
    timeoutMs: number,
): Promise<void> {
    const target = await headBlock(from);
    if (target === null) {
        throw new Error(`No head block to sync to on ${from}`);
    }
    await poll(`${socketPath} to reach block ${target}`, timeoutMs, async () => {
        const blockNum = await headBlock(socketPath);
        return blockNum !== null && blockNum >= target;
    });
}

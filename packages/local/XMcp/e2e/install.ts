import type { Devnet } from "../../../../e2e/fixtures/devnet";

// Until XMcp/Mcp are in the boot package set (harness gap noted in the V2 doc),
// specs install locally built packages when these env vars point at them:
//   XMCP_PSI=<...>/XMcp.psi  MCP_PSI=<...>/Mcp.psi
//   PROFILES_PSI=<...>/Profiles.psi  (optional; mcp agent-sign uses profiles plugin)
const done = new WeakSet<object>();

async function installWithRetry(devnet: Devnet, args: string[]) {
    let last: unknown;
    for (let i = 0; i < 5; i++) {
        try {
            await devnet.psibase(["install", "-y", ...args]);
            return;
        } catch (e) {
            last = e;
            await new Promise((r) => setTimeout(r, 500 * (i + 1)));
        }
    }
    throw last;
}

export async function installMcpPackages(devnet: Devnet) {
    if (done.has(devnet)) return;
    done.add(devnet);
    if (process.env.PROFILES_PSI) await installWithRetry(devnet, [process.env.PROFILES_PSI]);
    if (process.env.MCP_PSI) await installWithRetry(devnet, [process.env.MCP_PSI]);
    if (process.env.XMCP_PSI) await installWithRetry(devnet, ["--local", process.env.XMCP_PSI]);
}

import type { Devnet } from "../../fixtures/devnet";

// Until XMcp/Mcp are in the boot package set (harness gap noted in the V2 doc),
// specs install locally built packages when these env vars point at them:
//   XMCP_PSI=<...>/XMcp.psi  MCP_PSI=<...>/Mcp.psi
const done = new WeakSet<object>();
export async function installMcpPackages(devnet: Devnet) {
    if (done.has(devnet)) return;
    done.add(devnet);
    if (process.env.MCP_PSI) await devnet.psibase(["install", "-y", process.env.MCP_PSI]);
    if (process.env.XMCP_PSI) await devnet.psibase(["install", "-y", "--local", process.env.XMCP_PSI]);
}

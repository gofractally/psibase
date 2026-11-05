import type { Devnet } from "../../../../e2e/fixtures/devnet";
import { createKeyAccount, pushActions, type KeyAccount } from "../../../../e2e/fixtures";
import { raw } from "../../../local/XMcp/e2e/client";

/** POST a GraphQL query to <sub>/graphql (optionally with a query token). */
export async function gql(devnet: Devnet, sub: string, query: string, token?: string): Promise<any> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await raw(devnet, sub, "POST", "/graphql", JSON.stringify({ query }), headers);
    return JSON.parse(r.text);
}

export interface AgentSetup {
    managed: KeyAccount;
    agent: KeyAccount;
    parent: KeyAccount;
}

/**
 * Delegated agent setup (V2 doc): managed account M registers its agent and
 * parent with `mcp`, then hands its auth to `mcp` via auth-dyn, in one tx.
 */
export async function setupAgent(devnet: Devnet, dir: string): Promise<AgentSetup> {
    const managed = await createKeyAccount(devnet, dir);
    const agent = await createKeyAccount(devnet, dir);
    const parent = await createKeyAccount(devnet, dir);
    await pushActions(devnet, dir, [
        { sender: managed.name, service: "mcp", method: "set_agent", data: { agent: agent.name, parent: parent.name } },
        { sender: managed.name, service: "auth-dyn", method: "set_mgmt", data: { account: managed.name, manager: "mcp" } },
        { sender: managed.name, service: "accounts", method: "setAuthServ", data: { authService: "auth-dyn" } },
    ], { keys: [managed.privateKeyPath] });
    return { managed, agent, parent };
}

export async function profileOf(devnet: Devnet, account: string): Promise<string | undefined> {
    const j = await gql(devnet, "profiles", `{ profile(account: "${account}") { displayName } }`);
    return j?.data?.profile?.displayName ?? undefined;
}

/** The agent stages `profiles.setProfile` as M; returns the staged-tx id if it is still pending. */
export async function agentSetsProfile(devnet: Devnet, dir: string, s: AgentSetup, displayName: string) {
    const out = await pushActions(devnet, dir, [
        { sender: s.managed.name, service: "profiles", method: "setProfile", data: { display_name: displayName, bio: "" } },
    ], { keys: [s.agent.privateKeyPath], proposer: s.agent.name });
    return out;
}

export async function pendingIdsFor(devnet: Devnet, proposer: string): Promise<number[]> {
    const j = await gql(devnet, "staged-tx", `{ getStagedByProposer(proposer: "${proposer}") { edges { node { id } } } }`);
    return (j?.data?.getStagedByProposer?.edges ?? []).map((e: any) => e.node.id);
}

import { useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Textarea } from "@shared/shadcn/ui/textarea";

import { accountNameError } from "../lib/account";
import {
    type AgentResult,
    normalizeActions,
    prefillFromSearch,
} from "../lib/agent-actions";
import { errorMessage, mcpCall } from "../lib/mcp";

async function stagedIdsFor(proposer: string): Promise<number[]> {
    const url = `${location.protocol}//staged-tx.${location.host.replace(/^mcp\./, "")}/graphql`;
    const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            query: `{ getStagedByProposer(proposer: "${proposer}") { edges { node { id } } } }`,
        }),
    });
    const j = await r.json();
    return (j?.data?.getStagedByProposer?.edges ?? []).map(
        (e: { node: { id: number } }) => e.node.id,
    );
}

export function AgentPage() {
    const prefill = prefillFromSearch(location.search);
    const [status, setStatus] = useState("");
    const [result, setResult] = useState<AgentResult | null>(null);
    const [busy, setBusy] = useState(false);

    const [agentAccount, setAgentAccount] = useState(prefill.agent);
    const [agentKey, setAgentKey] = useState("");
    const [owner, setOwner] = useState(prefill.owner);
    const [displayName, setDisplayName] = useState("");
    const [actionsJson, setActionsJson] = useState(prefill.actions);
    const [trackId, setTrackId] = useState("");

    const agentErr = agentAccount ? accountNameError(agentAccount) : null;
    const ownerErr = owner ? accountNameError(owner) : null;

    const run = async (label: string, fn: () => Promise<void>) => {
        setBusy(true);
        setStatus(label);
        try {
            await fn();
        } catch (e) {
            setStatus(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const propose = async () => {
        setResult(null);
        const agent = agentAccount.trim();
        try {
            const actions = normalizeActions(actionsJson.trim());
            const before = new Set(await stagedIdsFor(agent));
            await mcpCall("agent-sign", "propose-as", [
                owner.trim(),
                JSON.stringify(actions),
            ]);
            const after = await stagedIdsFor(agent);
            const pending = after.filter((id) => !before.has(id));
            if (pending.length === 0) {
                setResult({ ok: true, executed: true });
                setStatus("Executed.");
                return;
            }
            const stagedId = Math.max(...pending);
            let tracked = false;
            try {
                await mcpCall("agent-sign", "track", [stagedId]);
                tracked = true;
            } catch {
                tracked = false;
            }
            setResult({ ok: true, executed: false, stagedId, tracked });
            setStatus(
                `Staged as #${stagedId}; waiting for the owner to approve.`,
            );
        } catch (e) {
            setResult({ ok: false, error: errorMessage(e) });
            setStatus(errorMessage(e));
        }
    };

    return (
        <div className="bg-background text-foreground mx-auto max-w-xl space-y-8 p-6">
            <nav className="flex gap-4 text-sm">
                <a
                    className="text-primary underline-offset-4 hover:underline"
                    href="/"
                >
                    Approvals / setup
                </a>
                <a
                    className="text-primary underline-offset-4 hover:underline"
                    href="/agent.html"
                >
                    Agent sign
                </a>
                <a
                    className="text-primary underline-offset-4 hover:underline"
                    href="/agent.txt"
                >
                    Automation contract
                </a>
            </nav>

            <header className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                    Agent sign
                </h1>
                <p className="text-muted-foreground text-sm">
                    For agents (and tests): import the agent key, then propose
                    actions with the owner account as sender. Signing happens here with
                    the imported key; see <code>/agent.txt</code> for the
                    element ids an automated agent should use.
                </p>
            </header>

            <section data-testid="import-section" className="space-y-4">
                <h2 className="text-lg font-medium">1. Import agent key</h2>
                <div className="space-y-2">
                    <Label htmlFor="agent-account">Agent account</Label>
                    <Input
                        id="agent-account"
                        data-testid="agent-account"
                        autoComplete="off"
                        value={agentAccount}
                        aria-invalid={Boolean(agentErr)}
                        onChange={(e) => setAgentAccount(e.target.value)}
                    />
                    {agentErr ? (
                        <p className="text-destructive text-sm">{agentErr}</p>
                    ) : null}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="agent-key">Private key (PEM)</Label>
                    <Textarea
                        id="agent-key"
                        data-testid="agent-key"
                        rows={8}
                        value={agentKey}
                        onChange={(e) => setAgentKey(e.target.value)}
                    />
                </div>
                <Button
                    type="button"
                    id="btn-import"
                    data-testid="import-agent"
                    disabled={
                        busy ||
                        Boolean(agentErr) ||
                        !agentAccount.trim() ||
                        !agentKey.trim()
                    }
                    onClick={() =>
                        void run("Importing…", async () => {
                            await mcpCall("agent-sign", "import-agent", [
                                agentAccount.trim(),
                                agentKey.trim(),
                            ]);
                            setStatus(`Logged in as ${agentAccount.trim()}`);
                        })
                    }
                >
                    Import and login
                </Button>
            </section>

            <section data-testid="propose-section" className="space-y-4">
                <h2 className="text-lg font-medium">2. Propose as owner</h2>
                <div className="space-y-2">
                    <Label htmlFor="owner-account">Owner account</Label>
                    <Input
                        id="owner-account"
                        data-testid="owner-account"
                        autoComplete="off"
                        value={owner}
                        aria-invalid={Boolean(ownerErr)}
                        onChange={(e) => setOwner(e.target.value)}
                    />
                    {ownerErr ? (
                        <p className="text-destructive text-sm">{ownerErr}</p>
                    ) : null}
                </div>
                <div className="space-y-2">
                    <Label htmlFor="actions-json">Actions</Label>
                    <p className="text-muted-foreground text-xs">
                        Paste the X-MCP <code>build_transaction</code> result,
                        or an array of{" "}
                        <code>{`{ "service", "method", "rawData" }`}</code> with
                        hex-encoded args.
                    </p>
                    <Textarea
                        id="actions-json"
                        data-testid="actions-json"
                        rows={8}
                        value={actionsJson}
                        onChange={(e) => setActionsJson(e.target.value)}
                    />
                </div>
                <Button
                    type="button"
                    id="btn-propose"
                    data-testid="propose-as"
                    disabled={
                        busy ||
                        Boolean(ownerErr) ||
                        !owner.trim() ||
                        !actionsJson.trim()
                    }
                    onClick={() => void run("Proposing…", propose)}
                >
                    Propose and sign
                </Button>

                <details className="text-sm">
                    <summary className="text-muted-foreground cursor-pointer">
                        Demo and manual tracking
                    </summary>
                    <div className="space-y-4 pt-3">
                        <div className="space-y-2">
                            <Label htmlFor="display-name">
                                Profile display name (demo)
                            </Label>
                            <Input
                                id="display-name"
                                data-testid="display-name"
                                autoComplete="off"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                            />
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            data-testid="propose-set-profile"
                            disabled={
                                busy || Boolean(ownerErr) || !owner.trim()
                            }
                            onClick={() =>
                                void run("Proposing setProfile…", async () => {
                                    await mcpCall(
                                        "agent-sign",
                                        "propose-set-profile",
                                        [
                                            owner.trim(),
                                            displayName.trim(),
                                            "",
                                        ],
                                    );
                                    setStatus(
                                        "setProfile submitted (covered actions auto-execute).",
                                    );
                                })
                            }
                        >
                            Set profile
                        </Button>
                        <div className="space-y-2">
                            <Label htmlFor="track-id">
                                Staged tx id (if still pending)
                            </Label>
                            <Input
                                id="track-id"
                                data-testid="track-id"
                                type="number"
                                min={0}
                                value={trackId}
                                onChange={(e) => setTrackId(e.target.value)}
                            />
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            data-testid="track"
                            disabled={busy || trackId === ""}
                            onClick={() =>
                                void run("Tracking…", async () => {
                                    const id = Number(trackId);
                                    await mcpCall("agent-sign", "track", [id]);
                                    setStatus(`Tracked staged tx #${id}`);
                                })
                            }
                        >
                            Track for owner approval
                        </Button>
                    </div>
                </details>
            </section>

            <p
                className="min-h-6 text-sm"
                data-testid="agent-status"
                id="status"
            >
                {status}
            </p>
            <pre
                className="bg-muted min-h-6 rounded-md p-2 text-xs"
                data-testid="agent-result"
                id="result"
            >
                {result ? JSON.stringify(result) : ""}
            </pre>
        </div>
    );
}

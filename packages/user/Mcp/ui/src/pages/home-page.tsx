import type { AgentCfg, PendingRow } from "../lib/logic";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Textarea } from "@shared/shadcn/ui/textarea";

import {
    MAX_ACCOUNT_NAME_LENGTH,
    setupNameErrors,
    setupNamesValid,
} from "../lib/account";
import { agentHandOffPrompt, summarize } from "../lib/logic";
import { errorMessage, loginAsParent, mcpCall } from "../lib/mcp";

type SetupStep = "form" | "save" | "confirm" | "done";

export function HomePage() {
    const [status, setStatus] = useState("Loading…");
    const [rows, setRows] = useState<PendingRow[] | null>(null);
    const [agents, setAgents] = useState<AgentCfg[]>([]);
    const [setupStatus, setSetupStatus] = useState("");
    const [needsLogin, setNeedsLogin] = useState(false);

    const [managed, setManaged] = useState("");
    const [agent, setAgent] = useState("");
    const [step, setStep] = useState<SetupStep>("form");
    const [pendingPem, setPendingPem] = useState("");
    const [pendingAgent, setPendingAgent] = useState("");
    const [pendingManaged, setPendingManaged] = useState("");
    const [savedAck, setSavedAck] = useState(false);
    const [confirmPem, setConfirmPem] = useState("");
    const [busy, setBusy] = useState(false);
    const [autoDebitWarning, setAutoDebitWarning] = useState("");
    const [selectedManaged, setSelectedManaged] = useState<string | null>(null);
    const [copiedPrompt, setCopiedPrompt] = useState(false);

    const nameErrors = useMemo(
        () => setupNameErrors(managed, agent),
        [managed, agent],
    );
    const canCreate = setupNamesValid(managed, agent) && !busy;

    const selectedCfg = useMemo(
        () => agents.find((a) => a.account === selectedManaged) ?? null,
        [agents, selectedManaged],
    );
    const handOffPrompt = useMemo(() => {
        if (!selectedCfg) return "";
        const pem =
            selectedCfg.agent === pendingAgent && pendingPem
                ? pendingPem
                : undefined;
        return agentHandOffPrompt(selectedCfg, { pem });
    }, [selectedCfg, pendingAgent, pendingPem]);

    const refreshAgents = useCallback(async () => {
        try {
            const res = await mcpCall("setup", "my-agents");
            const parsed =
                typeof res === "string" ? JSON.parse(res) : (res as AgentCfg[]);
            setAgents(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
            setAgents([]);
            setSetupStatus(errorMessage(e));
        }
    }, []);

    const refresh = useCallback(async () => {
        setStatus("Loading…");
        try {
            const res = await mcpCall("approvals", "needs-approval");
            if (typeof res !== "string" || !res.startsWith("[")) {
                throw new Error(String(res));
            }
            setRows(JSON.parse(res) as PendingRow[]);
            setNeedsLogin(false);
            setStatus("");
            await refreshAgents();
        } catch (e) {
            setRows(null);
            setNeedsLogin(true);
            setStatus(`Log in to view your approvals. (${errorMessage(e)})`);
            setSetupStatus("Log in to set up an agent.");
        }
    }, [refreshAgents]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const onCreate = async () => {
        if (!canCreate) return;
        setBusy(true);
        setSetupStatus("Creating agent account…");
        try {
            const pem = await mcpCall("setup", "create-agent-account", [
                agent.trim(),
            ]);
            if (typeof pem !== "string" || !/BEGIN.*PRIVATE KEY/.test(pem)) {
                throw new Error(
                    typeof pem === "string"
                        ? pem
                        : "create-agent-account returned no key",
                );
            }
            setPendingPem(pem);
            setPendingAgent(agent.trim());
            setSavedAck(false);
            setStep("save");
            setSetupStatus(
                `Created ${agent.trim()}. Save the key, then confirm.`,
            );
        } catch (e) {
            setSetupStatus(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const resetSetupForm = () => {
        setManaged("");
        setAgent("");
        setPendingPem("");
        setPendingAgent("");
        setPendingManaged("");
        setSavedAck(false);
        setConfirmPem("");
        setAutoDebitWarning("");
        setSetupStatus("");
        setStep("form");
    };

    const onConfirm = async () => {
        setBusy(true);
        setSetupStatus("Confirming…");
        setAutoDebitWarning("");
        const managedName = managed.trim();
        const agentName = pendingAgent;
        const key = confirmPem.trim();
        try {
            const ok = await mcpCall("setup", "confirm-agent-key", [
                agentName,
                key,
            ]);
            if (!ok) throw new Error("Key does not match the agent account");
            setSetupStatus("Bootstrapping managed account…");
            // Parent-only tx first. Agent auto-debit is a separate call so it
            // is not packed into a multi-sender transaction that would abort.
            await mcpCall("setup", "bootstrap", [managedName, agentName]);
            setPendingManaged(managedName);
            setPendingPem(key);
            const parent = String(await mcpCall("setup", "current-user"));
            try {
                setSetupStatus("Enabling agent auto-debit…");
                await mcpCall("setup", "enable-agent-auto-debit", [
                    agentName,
                    key,
                ]);
            } catch (e) {
                setAutoDebitWarning(
                    `Managed account is ready, but agent auto-debit failed: ${errorMessage(e)}`,
                );
            }
            // Separate call: the agent must stay logged in until its tx is signed.
            try {
                await mcpCall("setup", "restore-parent", [parent]);
            } catch (e) {
                setAutoDebitWarning(
                    `Could not log ${parent} back in: ${errorMessage(e)}`,
                );
            }
            await refreshAgents();
            setSelectedManaged(managedName);
            setCopiedPrompt(false);
            setStep("done");
            setSetupStatus("Setup complete.");
        } catch (e) {
            setSetupStatus(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const runApproval = async (
        method: "approve" | "approve-and-grant",
        row: PendingRow,
    ) => {
        setBusy(true);
        try {
            await mcpCall("approvals", method, [
                row.pending.account,
                row.pending.id,
            ]);
            await refresh();
        } catch (e) {
            setStatus(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const downloadKey = () => {
        const blob = new Blob([pendingPem], {
            type: "application/x-pem-file",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${pendingAgent || "agent"}.pem`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <div className="bg-background text-foreground mx-auto max-w-3xl space-y-8 p-6">
            <nav className="flex gap-4 text-sm">
                <a
                    className="text-primary underline-offset-4 hover:underline"
                    href="/"
                >
                    Approvals
                </a>
                <a
                    className="text-primary underline-offset-4 hover:underline"
                    href="/agent.html"
                    data-testid="agent-sign-link"
                >
                    Agent sign
                </a>
            </nav>

            <header className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                    Needs approval
                </h1>
                <p className="text-muted-foreground text-sm">
                    Transactions your agents proposed that need more permission
                    than you have granted them.
                </p>
                <p className="text-sm" data-testid="status">
                    {status}
                </p>
            </header>

            <div id="list" className="space-y-3">
                {needsLogin ? (
                    <Button
                        data-testid="login"
                        onClick={() => void loginAsParent()}
                    >
                        Log in
                    </Button>
                ) : rows && rows.length === 0 ? (
                    <p
                        className="text-muted-foreground text-sm"
                        data-testid="empty"
                    >
                        Nothing needs approval.
                    </p>
                ) : (
                    rows?.map((r) => (
                        <div
                            key={r.pending.id}
                            className="border-border space-y-2 rounded-lg border p-4"
                            data-testid="pending-row"
                            data-id={r.pending.id}
                        >
                            <div className="text-sm">
                                <b>#{r.pending.id}</b> for{" "}
                                <code>{r.pending.account}</code> (proposed by{" "}
                                {r.pending.proposer})
                            </div>
                            <div className="text-muted-foreground text-sm">
                                {summarize(r)}
                            </div>
                            <div className="text-sm text-amber-700 dark:text-amber-400">
                                Not yet granted:{" "}
                                {r.missing.join(", ") || "none"}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="outline"
                                    disabled={busy}
                                    data-act="approve"
                                    onClick={() =>
                                        void runApproval("approve", r)
                                    }
                                >
                                    Approve
                                </Button>
                                <Button
                                    disabled={busy}
                                    data-act="grant"
                                    onClick={() =>
                                        void runApproval("approve-and-grant", r)
                                    }
                                >
                                    Approve and Grant
                                </Button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <section
                id="setup"
                data-testid="agent-setup"
                className="border-border space-y-4 border-t pt-8"
            >
                <h2 className="text-xl font-semibold">Set up an agent</h2>
                <p className="text-muted-foreground text-sm">
                    Creates an AuthSig agent account (save the key), then a
                    managed account under AuthDyn that your agent can act
                    through. You (logged-in) are the parent who approves
                    uncovered actions. Both new accounts get tokens auto-debit
                    enabled.
                </p>
                <p className="text-sm" data-testid="setup-status">
                    {setupStatus}
                </p>
                <div data-testid="my-agents">
                    {agents.length === 0 ? (
                        <p
                            className="text-muted-foreground text-sm"
                            data-testid="no-agents"
                        >
                            No agents wired yet.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            <h3 className="text-sm font-medium">
                                Existing agents
                            </h3>
                            <p className="text-muted-foreground text-xs">
                                On-chain setups for this parent. Use new account
                                names below to create another.
                            </p>
                            <ul
                                data-testid="agent-list"
                                className="space-y-1 text-sm"
                            >
                                {agents.map((a) => {
                                    const selected =
                                        a.account === selectedManaged;
                                    return (
                                        <li key={a.account}>
                                            <button
                                                type="button"
                                                data-testid="agent-cfg"
                                                data-account={a.account}
                                                aria-pressed={selected}
                                                className={
                                                    selected
                                                        ? "border-primary bg-muted w-full rounded-md border px-3 py-2 text-left"
                                                        : "border-border hover:bg-muted/50 w-full rounded-md border px-3 py-2 text-left"
                                                }
                                                onClick={() => {
                                                    setSelectedManaged(
                                                        a.account,
                                                    );
                                                    setCopiedPrompt(false);
                                                }}
                                            >
                                                managed <code>{a.account}</code>{" "}
                                                · agent <code>{a.agent}</code> ·
                                                parent <code>{a.parent}</code>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                            {selectedCfg ? (
                                <div
                                    className="space-y-2 pt-2"
                                    data-testid="agent-prompt"
                                >
                                    <p className="text-sm font-medium">
                                        Prompt for your agent
                                    </p>
                                    <p className="text-muted-foreground text-xs">
                                        Give this to your agent.{" "}
                                        {pendingAgent === selectedCfg.agent &&
                                        pendingPem
                                            ? "The key from this session is included."
                                            : "Replace the key placeholder with the agent PEM you saved at setup."}
                                    </p>
                                    <Textarea
                                        data-testid="agent-prompt-text"
                                        readOnly
                                        rows={14}
                                        className="font-mono text-xs"
                                        value={handOffPrompt}
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        data-testid="copy-agent-prompt"
                                        onClick={async () => {
                                            await navigator.clipboard.writeText(
                                                handOffPrompt,
                                            );
                                            setCopiedPrompt(true);
                                        }}
                                    >
                                        {copiedPrompt
                                            ? "Copied"
                                            : "Copy prompt"}
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>

                {step === "form" && (
                    <div id="setup-form" className="max-w-md space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="managed-name">
                                Managed account name
                            </Label>
                            <Input
                                id="managed-name"
                                data-testid="managed-name"
                                autoComplete="off"
                                maxLength={MAX_ACCOUNT_NAME_LENGTH}
                                value={managed}
                                aria-invalid={Boolean(
                                    managed && nameErrors.managed,
                                )}
                                onChange={(e) => setManaged(e.target.value)}
                            />
                            {managed && nameErrors.managed ? (
                                <p className="text-destructive text-sm">
                                    {nameErrors.managed}
                                </p>
                            ) : (
                                <p className="text-muted-foreground text-xs">
                                    {MAX_ACCOUNT_NAME_LENGTH} chars max;
                                    lowercase letters, numbers, hyphens.
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="agent-name">
                                Agent account name
                            </Label>
                            <Input
                                id="agent-name"
                                data-testid="agent-name"
                                autoComplete="off"
                                maxLength={MAX_ACCOUNT_NAME_LENGTH}
                                value={agent}
                                aria-invalid={Boolean(
                                    agent && nameErrors.agent,
                                )}
                                onChange={(e) => setAgent(e.target.value)}
                            />
                            {agent && nameErrors.agent ? (
                                <p className="text-destructive text-sm">
                                    {nameErrors.agent}
                                </p>
                            ) : null}
                        </div>
                        {nameErrors.form ? (
                            <p className="text-destructive text-sm">
                                {nameErrors.form}
                            </p>
                        ) : null}
                        <Button
                            type="button"
                            data-testid="create-agent"
                            disabled={!canCreate}
                            onClick={() => void onCreate()}
                        >
                            Create agent account
                        </Button>
                    </div>
                )}

                {step === "save" && (
                    <div id="setup-save" className="max-w-xl space-y-4">
                        <p className="text-sm">
                            Save this agent private key. You cannot recover it
                            later.
                        </p>
                        <code
                            className="bg-muted block whitespace-pre-wrap break-all rounded-md p-3 text-xs"
                            id="agent-pem"
                            data-testid="agent-pem"
                        >
                            {pendingPem}
                        </code>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                data-testid="download-key"
                                onClick={downloadKey}
                            >
                                Download .pem
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                data-testid="copy-key"
                                onClick={async () => {
                                    await navigator.clipboard.writeText(
                                        pendingPem,
                                    );
                                    setSetupStatus("Copied.");
                                }}
                            >
                                Copy
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="saved-ack"
                                data-testid="saved-ack"
                                checked={savedAck}
                                onCheckedChange={(v) => setSavedAck(v === true)}
                            />
                            <Label htmlFor="saved-ack">
                                I have saved this key
                            </Label>
                        </div>
                        <Button
                            type="button"
                            data-testid="continue-confirm"
                            disabled={!savedAck}
                            onClick={() => {
                                setConfirmPem("");
                                setStep("confirm");
                            }}
                        >
                            Continue
                        </Button>
                    </div>
                )}

                {step === "confirm" && (
                    <div id="setup-confirm" className="max-w-xl space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="confirm-pem">
                                Paste the agent private key to confirm
                            </Label>
                            <Textarea
                                id="confirm-pem"
                                data-testid="confirm-pem"
                                rows={6}
                                value={confirmPem}
                                onChange={(e) => setConfirmPem(e.target.value)}
                            />
                        </div>
                        <Button
                            type="button"
                            data-testid="confirm-bootstrap"
                            disabled={busy || !confirmPem.trim()}
                            onClick={() => void onConfirm()}
                        >
                            Confirm and bootstrap
                        </Button>
                    </div>
                )}

                {step === "done" && (
                    <div
                        id="setup-done"
                        className="max-w-xl space-y-4"
                        data-testid="setup-done"
                    >
                        <p
                            className="text-sm font-medium"
                            data-testid="setup-success"
                        >
                            Ready. Managed <code>{pendingManaged}</code> is
                            under AuthDyn with agent <code>{pendingAgent}</code>
                            .
                        </p>
                        <p className="text-muted-foreground text-sm">
                            Keep the agent private key you saved — it cannot be
                            recovered. Use{" "}
                            <a
                                className="text-primary underline-offset-4 hover:underline"
                                href="/agent.html"
                            >
                                Agent sign
                            </a>{" "}
                            to import it in this browser when you want the agent
                            to propose actions.
                        </p>
                        {autoDebitWarning ? (
                            <p
                                className="text-sm text-amber-700 dark:text-amber-400"
                                data-testid="auto-debit-warning"
                            >
                                {autoDebitWarning}
                            </p>
                        ) : (
                            <p className="text-muted-foreground text-sm">
                                Tokens auto-debit is enabled on both accounts.
                            </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                data-testid="download-key-again"
                                onClick={downloadKey}
                            >
                                Download agent key again
                            </Button>
                            <Button
                                type="button"
                                data-testid="setup-another"
                                onClick={resetSetupForm}
                            >
                                Set up another
                            </Button>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

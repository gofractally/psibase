import type { AgentCfg, PendingRow } from "../lib/logic";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@shared/shadcn/ui/button";
import { Checkbox } from "@shared/shadcn/ui/checkbox";
import { Input } from "@shared/shadcn/ui/input";
import { Label } from "@shared/shadcn/ui/label";
import { Textarea } from "@shared/shadcn/ui/textarea";

import {
    type ApprovalMethod,
    PendingApproval,
} from "../components/pending-approval";
import {
    MAX_ACCOUNT_NAME_LENGTH,
    enforcerNameError,
    setupNameErrors,
    setupNamesValid,
} from "../lib/account";
import { agentHandOffPrompt } from "../lib/logic";
import { errorMessage, loginAsParent, mcpCall } from "../lib/mcp";

type SetupStep = "form" | "save" | "confirm" | "done";

export function HomePage() {
    const [status, setStatus] = useState("Loading…");
    const [rows, setRows] = useState<PendingRow[] | null>(null);
    const [agents, setAgents] = useState<AgentCfg[]>([]);
    const [setupStatus, setSetupStatus] = useState("");
    const [needsLogin, setNeedsLogin] = useState(false);

    // Logged-in owner: the sender on the agent's staged txs (no managed account).
    const [owner, setOwner] = useState("");
    const [agent, setAgent] = useState("");
    const [enforcer, setEnforcer] = useState("");
    const [enforcerPem, setEnforcerPem] = useState("");
    const [confirmEnforcerPem, setConfirmEnforcerPem] = useState("");
    const refreshing = useRef(false);
    const [step, setStep] = useState<SetupStep>("form");
    const [pendingPem, setPendingPem] = useState("");
    const [pendingAgent, setPendingAgent] = useState("");
    const [savedAck, setSavedAck] = useState(false);
    const [confirmPem, setConfirmPem] = useState("");
    const [busy, setBusy] = useState(false);
    const [watching, setWatching] = useState(false);
    const [autoDebitWarning, setAutoDebitWarning] = useState("");
    const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
    const [copiedPrompt, setCopiedPrompt] = useState(false);
    const [copiedKey, setCopiedKey] = useState(false);

    const nameErrors = useMemo(
        () => setupNameErrors(agent, owner),
        [agent, owner],
    );
    // One agent per owner: setup is only offered until one is wired.
    const canCreate =
        Boolean(owner) &&
        agents.length === 0 &&
        setupNamesValid(agent, owner) &&
        !enforcerNameError(enforcer, agent, owner) &&
        !busy &&
        !watching;

    const selectedCfg = useMemo(
        () => agents.find((a) => a.account === selectedOwner) ?? null,
        [agents, selectedOwner],
    );
    const handOffPrompt = useMemo(() => {
        if (!selectedCfg) return "";
        return agentHandOffPrompt(selectedCfg, location);
    }, [selectedCfg]);
    const handOffPem =
        selectedCfg && selectedCfg.agent === pendingAgent && pendingPem
            ? pendingPem
            : "";

    const refreshAgents = useCallback(async () => {
        try {
            const res = await mcpCall("setup", "my-agents");
            const parsed =
                typeof res === "string" ? JSON.parse(res) : (res as AgentCfg[]);
            setAgents(Array.isArray(parsed) ? parsed : []);
            setOwner(String(await mcpCall("setup", "current-user")));
        } catch (e) {
            setAgents([]);
            setSetupStatus(errorMessage(e));
        }
    }, []);

    const refresh = useCallback(async () => {
        if (refreshing.current) return;
        refreshing.current = true;
        setWatching(true);
        setStatus("Loading…");
        try {
            const res = await mcpCall("approvals", "needs-approval");
            if (typeof res !== "string" || !res.startsWith("[")) {
                throw new Error(String(res));
            }
            let pending = JSON.parse(res) as PendingRow[];
            setRows(pending);
            let watcherError = "";
            for (const row of pending.filter((r) => r.canEnforce)) {
                try {
                    await mcpCall("approvals", "enforce", [
                        row.pending.account,
                        row.pending.id,
                    ]);
                    // Do not assume accept executed/deleted the proposal.
                    // Re-query after restoring the owner below.
                } catch (e) {
                    watcherError = `Enforcer withheld or unavailable: ${errorMessage(e)}`;
                } finally {
                    // The enforcer must remain logged in until its call signs.
                    await mcpCall("setup", "restore-parent", [
                        row.pending.account,
                    ]);
                }
            }
            if (pending.some((r) => r.canEnforce)) {
                const live = await mcpCall("approvals", "needs-approval");
                pending = JSON.parse(String(live)) as PendingRow[];
            }
            setRows(pending);
            setNeedsLogin(false);
            setStatus(watcherError);
            await refreshAgents();
        } catch (e) {
            setRows(null);
            setNeedsLogin(true);
            setStatus(`Log in to view your approvals. (${errorMessage(e)})`);
            setSetupStatus("Log in to set up an agent.");
        } finally {
            refreshing.current = false;
            setWatching(false);
        }
    }, [refreshAgents]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        if (busy || step === "save" || step === "confirm") return;
        const timer = window.setInterval(() => void refresh(), 10000);
        return () => window.clearInterval(timer);
    }, [busy, step, refresh]);

    const onCreate = async () => {
        if (!canCreate || refreshing.current) return;
        setBusy(true);
        setSetupStatus("Creating agent account…");
        try {
            const pem =
                pendingAgent === agent.trim() && pendingPem
                    ? pendingPem
                    : await mcpCall("setup", "create-agent-account", [
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
            const verifierKey = await mcpCall("setup", "create-agent-account", [
                enforcer.trim(),
            ]);
            if (
                typeof verifierKey !== "string" ||
                !/BEGIN.*PRIVATE KEY/.test(verifierKey)
            )
                throw new Error("No enforcer key returned");
            setEnforcerPem(verifierKey);
            setSavedAck(false);
            setStep("save");
            setSetupStatus(
                `Created ${agent.trim()}. Save both keys, then confirm.`,
            );
        } catch (e) {
            setSetupStatus(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const resetSetupForm = () => {
        setAgent("");
        setEnforcer("");
        setEnforcerPem("");
        setConfirmEnforcerPem("");
        setPendingPem("");
        setPendingAgent("");
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
        const agentName = pendingAgent;
        const key = confirmPem.trim();
        try {
            const ok = await mcpCall("setup", "confirm-agent-key", [
                agentName,
                key,
            ]);
            if (!ok) throw new Error("Key does not match the agent account");
            const verifierKey = confirmEnforcerPem.trim();
            const verifierOk = await mcpCall("setup", "confirm-agent-key", [
                enforcer.trim(),
                verifierKey,
            ]);
            if (!verifierOk)
                throw new Error("Key does not match the enforcer account");
            await mcpCall("setup", "import-enforcer", [
                enforcer.trim(),
                verifierKey,
            ]);
            setSetupStatus("Registering agent and enforcer on your account…");
            // Owner-only tx first (mcp::bootstrap + accounts::setAuthServ(mcp);
            // your key is unchanged). Agent auto-debit is a separate call so it
            // is not packed into a multi-sender transaction that would abort.
            await mcpCall("setup", "bootstrap", [agentName, enforcer.trim()]);
            setPendingPem(key);
            setEnforcerPem("");
            setConfirmEnforcerPem("");
            const ownerName = String(await mcpCall("setup", "current-user"));
            try {
                setSetupStatus("Enabling agent auto-debit…");
                await mcpCall("setup", "enable-agent-auto-debit", [
                    agentName,
                    key,
                ]);
            } catch (e) {
                setAutoDebitWarning(
                    `Agent is registered, but agent auto-debit failed: ${errorMessage(e)}`,
                );
            }
            // Separate call: the agent must stay logged in until its tx is signed.
            try {
                await mcpCall("setup", "restore-parent", [ownerName]);
            } catch (e) {
                setAutoDebitWarning(
                    `Could not log ${ownerName} back in: ${errorMessage(e)}`,
                );
            }
            await refreshAgents();
            setSelectedOwner(ownerName);
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
        method: ApprovalMethod,
        row: PendingRow,
        rules?: string,
    ) => {
        if (refreshing.current) return;
        setBusy(true);
        try {
            await mcpCall("approvals", method, [
                row.pending.account,
                row.pending.id,
                ...(method === "approve-and-grant" ? [rules ?? "[]"] : []),
            ]);
            await refresh();
        } catch (e) {
            setStatus(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const saveKey = (pem: string, name: string) => {
        const blob = new Blob([pem], {
            type: "application/x-pem-file",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${name}.pem`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const downloadKey = () => saveKey(pendingPem, pendingAgent || "agent");

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
                        <PendingApproval
                            key={`${r.pending.id}:${r.inspection}`}
                            row={r}
                            busy={busy || watching}
                            run={runApproval}
                        />
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
                    Creates AuthSig agent and enforcer accounts (save both keys)
                    and registers it on your own account: the agent proposes
                    staged transactions with you as the sender. Allowlisted
                    actions run on the agent and enforcer signatures; you
                    approve the rest. Your account switches to the mcp auth
                    service but keeps your existing key and login. The agent
                    gets tokens auto-debit enabled.
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
                                The agent registered on your account.
                            </p>
                            <ul
                                data-testid="agent-list"
                                className="space-y-1 text-sm"
                            >
                                {agents.map((a) => {
                                    const selected =
                                        a.account === selectedOwner;
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
                                                    setSelectedOwner(a.account);
                                                    setCopiedPrompt(false);
                                                    setCopiedKey(false);
                                                }}
                                            >
                                                owner <code>{a.account}</code> ·
                                                agent <code>{a.agent}</code>
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
                                        Give this to your agent. The private key
                                        is separate — only share it when the
                                        agent asks and can store a secret.
                                    </p>
                                    <Textarea
                                        data-testid="agent-prompt-text"
                                        readOnly
                                        rows={12}
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
                                            setCopiedKey(false);
                                        }}
                                    >
                                        {copiedPrompt
                                            ? "Copied"
                                            : "Copy prompt"}
                                    </Button>
                                    {handOffPem ? (
                                        <div className="space-y-2 pt-2">
                                            <Label>
                                                Agent private key for{" "}
                                                <code>{selectedCfg.agent}</code>
                                            </Label>
                                            <code
                                                className="bg-muted block whitespace-pre-wrap break-all rounded-md p-3 text-xs"
                                                data-testid="agent-prompt-pem"
                                            >
                                                {handOffPem}
                                            </code>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                data-testid="copy-agent-prompt-pem"
                                                onClick={async () => {
                                                    await navigator.clipboard.writeText(
                                                        handOffPem,
                                                    );
                                                    setCopiedKey(true);
                                                    setCopiedPrompt(false);
                                                }}
                                            >
                                                {copiedKey
                                                    ? "Copied"
                                                    : "Copy"}
                                            </Button>
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>

                {step === "form" && agents.length === 0 && (
                    <div id="setup-form" className="max-w-md space-y-4">
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
                        <div className="space-y-2">
                            <Label htmlFor="enforcer-name">
                                Enforcer account name (owner-held key)
                            </Label>
                            <Input
                                id="enforcer-name"
                                data-testid="enforcer-name"
                                value={enforcer}
                                maxLength={MAX_ACCOUNT_NAME_LENGTH}
                                onChange={(e) => setEnforcer(e.target.value)}
                            />
                            <p className="text-xs">
                                Owner, agent and enforcer must all differ. Never
                                give the enforcer key to the agent.
                            </p>
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
                            Save both private keys. You cannot recover them
                            later.
                        </p>
                        <div className="space-y-2">
                            <Label htmlFor="agent-pem">
                                Agent key for <code>{pendingAgent}</code>
                            </Label>
                            <p className="text-muted-foreground text-xs">
                                Give this to your agent so it can propose
                                transactions.
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
                                    data-testid="copy-key"
                                    onClick={async () => {
                                        await navigator.clipboard.writeText(
                                            pendingPem,
                                        );
                                        setSetupStatus(
                                            `Copied agent key for ${pendingAgent}.`,
                                        );
                                    }}
                                >
                                    Copy
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    data-testid="download-key"
                                    onClick={downloadKey}
                                >
                                    Download
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="enforcer-pem">
                                Enforcer key for <code>{enforcer}</code>
                            </Label>
                            <p className="text-muted-foreground text-xs">
                                Keep this yourself. Never give it to your agent.
                                The host vault retains it for checks while this
                                UI is open.
                            </p>
                            <code
                                className="bg-muted block whitespace-pre-wrap break-all rounded-md p-3 text-xs"
                                id="enforcer-pem"
                                data-testid="enforcer-pem"
                            >
                                {enforcerPem}
                            </code>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    data-testid="copy-enforcer-key"
                                    onClick={async () => {
                                        await navigator.clipboard.writeText(
                                            enforcerPem,
                                        );
                                        setSetupStatus(
                                            `Copied enforcer key for ${enforcer}.`,
                                        );
                                    }}
                                >
                                    Copy
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    data-testid="download-enforcer-key"
                                    onClick={() =>
                                        saveKey(
                                            enforcerPem,
                                            enforcer || "enforcer",
                                        )
                                    }
                                >
                                    Download
                                </Button>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="saved-ack"
                                data-testid="saved-ack"
                                checked={savedAck}
                                onCheckedChange={(v) => setSavedAck(v === true)}
                            />
                            <Label htmlFor="saved-ack">
                                I have saved both keys
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
                        <Label htmlFor="confirm-enforcer-pem">
                            Paste the enforcer private key to confirm (owner
                            only)
                        </Label>
                        <Textarea
                            id="confirm-enforcer-pem"
                            data-testid="confirm-enforcer-pem"
                            rows={6}
                            value={confirmEnforcerPem}
                            onChange={(e) =>
                                setConfirmEnforcerPem(e.target.value)
                            }
                        />
                        <Button
                            type="button"
                            data-testid="confirm-bootstrap"
                            disabled={
                                busy ||
                                !confirmPem.trim() ||
                                !confirmEnforcerPem.trim()
                            }
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
                            Ready. Agent <code>{pendingAgent}</code> can propose
                            as your account <code>{owner}</code>.
                        </p>
                        <p className="text-muted-foreground text-sm">
                            Keep both keys — they cannot be recovered. Use{" "}
                            <a
                                className="text-primary underline-offset-4 hover:underline"
                                href="/agent.html"
                            >
                                Agent sign
                            </a>{" "}
                            to import the agent key when it should propose
                            actions.
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
                                Tokens auto-debit is enabled on the agent.
                            </p>
                        )}
                        {pendingPem ? (
                            <div className="space-y-2">
                                <Label>
                                    Agent key for <code>{pendingAgent}</code>
                                </Label>
                                <code
                                    className="bg-muted block whitespace-pre-wrap break-all rounded-md p-3 text-xs"
                                    data-testid="agent-pem-again"
                                >
                                    {pendingPem}
                                </code>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        data-testid="copy-key-again"
                                        onClick={async () => {
                                            await navigator.clipboard.writeText(
                                                pendingPem,
                                            );
                                            setSetupStatus(
                                                `Copied agent key for ${pendingAgent}.`,
                                            );
                                        }}
                                    >
                                        Copy
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        data-testid="download-key-again"
                                        onClick={downloadKey}
                                    >
                                        Download
                                    </Button>
                                </div>
                            </div>
                        ) : null}
                        {enforcerPem ? (
                            <div className="space-y-2">
                                <Label>
                                    Enforcer key for <code>{enforcer}</code>
                                </Label>
                                <code
                                    className="bg-muted block whitespace-pre-wrap break-all rounded-md p-3 text-xs"
                                    data-testid="enforcer-pem-again"
                                >
                                    {enforcerPem}
                                </code>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        data-testid="copy-enforcer-key-again"
                                        onClick={async () => {
                                            await navigator.clipboard.writeText(
                                                enforcerPem,
                                            );
                                            setSetupStatus(
                                                `Copied enforcer key for ${enforcer}.`,
                                            );
                                        }}
                                    >
                                        Copy
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        data-testid="download-enforcer-key-again"
                                        onClick={() =>
                                            saveKey(
                                                enforcerPem,
                                                enforcer || "enforcer",
                                            )
                                        }
                                    >
                                        Download
                                    </Button>
                                </div>
                            </div>
                        ) : null}
                        <Button
                            type="button"
                            data-testid="setup-another"
                            onClick={resetSetupForm}
                        >
                            Set up another
                        </Button>
                    </div>
                )}
            </section>
        </div>
    );
}

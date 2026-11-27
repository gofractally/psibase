// Managing accounts: their state, the actions only the owner key may take,
// and what this visitor has used.
//
// Every action here asks for the passkey, derives the account's owner key,
// signs one transaction with it and wipes it (gofractally/psibase#2275,
// sections 4 and 5).
import {
    type KeySpec,
    accountKeys,
    accountNumber,
    activeSecret,
    privateKeyPem,
    publicKeyHex,
    publicKeyPem,
} from "./account-keys";
import { ANY_NAME_RULE, type PageContext, el, linkButton, setLinks } from "./context";
import {
    type ChainRecord,
    adoptFor,
    dropFromDevice,
    fetchRecord,
    forgetAccount,
    keysFor,
    loadDevice,
    recordInList,
    rememberOnDevice,
} from "./device";
import { pushAsOwner } from "./owner-tx";
import { type Unlocked } from "./passkey";

interface Usage {
    identity: string;
    kind: string;
    requests: number;
    elapsed_us: number;
    request_bytes: number;
    response_bytes: number;
}

const duration = (seconds: number) =>
    seconds % 86400 === 0
        ? `${seconds / 86400} day${seconds === 86400 ? "" : "s"}`
        : `${Math.round(seconds / 3600)} hours`;

const bytes = (n: number) =>
    n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const when = (date?: Date) =>
    date ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

export const runManageStep = async (ctx: PageContext) => {
    const { $, net } = ctx;
    const authOrigin = net.siblingOrigin("auth-sig");
    const body = $("mg-body");
    let selected =
        new URLSearchParams(window.location.search).get("account") ??
        loadDevice().current ??
        "";

    const notice = (message?: string) => {
        const node = $("mg-notice");
        node.hidden = !message;
        node.textContent = message ?? "";
    };

    const sponsor = await fetch(`${net.siblingOrigin("x-signup")}/status`, {
        headers: { Authorization: `Bearer ${net.token}` },
    })
        .then((r) => r.json())
        .then((s: { sponsor?: string | null }) => s.sponsor ?? undefined)
        .catch(() => undefined);

    const partnerName = (partner?: string) =>
        !partner ? "none" : partner === sponsor ? `${partner} (this network's sign-up service)` : partner;

    /**
     * Runs one owner-key action: passkey, owner key, the action, wipe. `run`
     * gets the keys the chain currently holds for the account.
     */
    const asOwner = async (
        name: string,
        why: string,
        run: (
            unlocked: Unlocked,
            keys: ReturnType<typeof accountKeys>,
            record: ChainRecord,
        ) => Promise<string | void>,
    ) => {
        notice();
        let unlocked: Unlocked | undefined;
        let ownerSecret: Uint8Array | undefined;
        let message: string | void = undefined;
        try {
            unlocked = await ctx.unlock("Confirm with your passkey", why);
            const found = await keysFor(net, unlocked, name);
            if (!found) {
                throw new Error(`This passkey does not hold the owner key of ${name}.`);
            }
            ownerSecret = found.keys.ownerSecret;
            ctx.working("Working", why);
            message = await run(unlocked, found.keys, found.record);
            // Queries can trail the transaction by a block.
            await new Promise((r) => setTimeout(r, 1200));
        } catch (e) {
            if (!ctx.isCancelled(e)) {
                message = e instanceof Error ? e.message : "Something went wrong.";
            }
        } finally {
            ownerSecret?.fill(0);
            unlocked?.wipe();
        }
        await render();
        notice(message || undefined);
    };

    const owner = (name: string, keys: ReturnType<typeof accountKeys>, method: string, data: unknown) =>
        pushAsOwner(net, name, keys.ownerSecret, [{ method, data }]);

    // The auth service reads a key in an action's JSON as PEM text.
    const spec = (k: KeySpec) => ({ key: publicKeyPem(k.key), seq: k.seq });

    // -------------------------------------------------------- actions

    const rotateActive = (name: string) =>
        asOwner(name, "Replacing the key your devices sign with.", async (unlocked, keys, record) => {
            const seq = record.active.seq + 1n;
            const next = activeSecret(unlocked.chainId, keys.ownerSecret, accountNumber(name), seq);
            try {
                await owner(name, keys, "setActive", {
                    active: spec({ key: publicKeyHex(next), seq: seq.toString() }),
                });
                await new Promise((r) => setTimeout(r, 1200));
                const entry = { name, ownerSeq: keys.owner.seq, activeSeq: seq.toString() };
                await adoptFor(ctx.app, name, privateKeyPem(next));
                rememberOnDevice(entry, false);
                await recordInList(net, unlocked, entry).catch((e) => console.warn(e));
            } finally {
                next.fill(0);
            }
            return `Other devices can no longer sign as ${name}. They get the new key the next time they sign in with your passkey.`;
        });

    const pause = (name: string) =>
        asOwner(name, `Pausing ${name}.`, async (_u, keys, record) => {
            await owner(name, keys, "pause", {});
            return `${name} is paused for ${duration(record.pauseSeconds)}. Nothing can be done as ${name} until then, unless its recovery partner ends the pause.`;
        });

    const freeze = (name: string) =>
        asOwner(name, `Freezing ${name}.`, async (_u, keys) => {
            await owner(name, keys, "freeze", {});
            dropHeld(name);
            return `${name} is frozen. Only its recovery partner can release it, with new keys.`;
        });

    const changePartner = (name: string, partner: string) =>
        asOwner(name, `Asking to make ${partner} the recovery partner.`, async (_u, keys, record) => {
            await owner(name, keys, "requestPartnerChange", { partner });
            return `Requested. ${name} is paused until ${partnerName(record.partner)} approves, or for ${duration(record.pauseSeconds)} if they do not.`;
        });

    const proposeKeys = (name: string) =>
        asOwner(name, `Sending new keys for ${name} to its recovery partner.`, async (unlocked, keys, record) => {
            const fresh = accountKeys(unlocked.chainId, unlocked.root, name, record.owner.seq + 1n, 0n);
            fresh.ownerSecret.fill(0);
            await owner(name, keys, "proposeRecovery", {
                owner: spec(fresh.owner),
                active: spec(fresh.active),
            });
            return `Sent. When ${partnerName(record.partner)} approves, use Recover an account to bring ${name} back to this browser.`;
        });

    // A paused or frozen account cannot sign, so this browser's key for it
    // is of no use until it is released.
    const dropHeld = (name: string) => {
        const entry = loadDevice().accounts.find((a) => a.name === name);
        if (entry) rememberOnDevice(entry, false, false);
    };

    const remove = async (name: string) => {
        ctx.working("Removing " + name, "from this browser");
        await forgetAccount(name).catch((e) => console.warn(e));
        dropFromDevice(name);
        selected = loadDevice().current ?? "";
        await render();
        notice(`${name} is no longer on this browser. Your passkey can bring it back.`);
    };

    // ---------------------------------------------------------- views

    const action = (label: string, hint: string, run: () => void, danger = false) => {
        const button = el("button", {
            class: "si-btn si-ghost" + (danger ? " si-danger" : ""),
            text: label,
            type: "button",
        });
        // Dangerous actions take a second click.
        let armed = !danger;
        button.addEventListener("click", () => {
            if (!armed) {
                armed = true;
                button.textContent = `${label} — click again to confirm`;
                return;
            }
            run();
        });
        return el("div", { class: "si-action" }, button, el("p", { class: "si-hint", text: hint }));
    };

    const row = (label: string, value: string) =>
        el("div", { class: "si-row" }, el("span", { text: label }), el("strong", { text: value }));

    const stateText = (record: ChainRecord) => {
        if (record.state === "frozen") return "Frozen";
        if (record.state === "paused") return `Paused until ${when(record.stateUntil)}`;
        return "In use";
    };

    const pendingText = (record: ChainRecord) => {
        const p = record.pending;
        if (!p) return undefined;
        if (p.kind === "partner") return `Recovery partner → ${partnerName(p.partner)}`;
        if (p.kind === "ownerKeys") return "New owner key";
        return `Pause ${duration(p.pauseSeconds ?? record.pauseSeconds)}, freeze window ${duration(p.freezeSeconds ?? record.freezeSeconds)}`;
    };

    const detail = (name: string, record: ChainRecord) => {
        const box = el("div", { class: "si-panel" });
        box.append(
            row("State", stateText(record)),
            row("Recovery partner", partnerName(record.partner)),
            row("Pause length", duration(record.pauseSeconds)),
            row("Freeze window", duration(record.freezeSeconds)),
        );
        const pending = pendingText(record);
        if (pending) {
            box.append(
                row("Waiting", pending),
                el("p", {
                    class: "si-hint",
                    text: `Takes effect ${when(record.stateUntil)}, or as soon as the recovery partner approves.`,
                }),
            );
        }
        const sponsored = !!sponsor && record.partner === sponsor;
        const release = () => ctx.go("account", { intent: "recover", account: name });

        if (record.state === "normal") {
            box.append(
                action(
                    "Sign out other devices",
                    "Replaces the key devices sign with. Use it if a device was lost.",
                    () => void rotateActive(name),
                ),
                action(
                    "Pause this account",
                    `Stops everything for ${duration(record.pauseSeconds)}. Use it when you are not sure what happened.`,
                    () => void pause(name),
                    true,
                ),
                action(
                    "Freeze this account",
                    record.partner
                        ? `Stops everything until ${partnerName(record.partner)} releases it with new keys.`
                        : "This account has no recovery partner: a freeze would be permanent.",
                    () => void freeze(name),
                    true,
                ),
            );
            const form = el("form", { class: "si-inline" });
            const input = el("input", { class: "si-input" });
            input.placeholder = "new partner's account";
            input.maxLength = 10;
            input.autocapitalize = "none";
            input.spellcheck = false;
            const submit = el("button", { class: "si-btn si-ghost", text: "Change recovery partner", type: "submit" });
            form.append(input, submit);
            form.addEventListener("submit", (e) => {
                e.preventDefault();
                const partner = input.value.trim().toLowerCase();
                if (!ANY_NAME_RULE.test(partner) || partner === name) {
                    notice("Enter the name of another account.");
                    return;
                }
                void changePartner(name, partner);
            });
            box.append(
                el(
                    "div",
                    { class: "si-action" },
                    form,
                    el("p", {
                        class: "si-hint",
                        text: `Pauses the account until the current partner approves, or for ${duration(record.pauseSeconds)}.`,
                    }),
                ),
            );
        } else if (record.state === "paused") {
            box.append(
                action(
                    "Freeze this account",
                    "Use this if you did not ask for the pause or the change that is waiting.",
                    () => void freeze(name),
                    true,
                ),
            );
            if (sponsored) {
                box.append(
                    action(
                        record.pending ? "Approve now" : "End the pause now",
                        "Sign in the way you did when you created the account, and the sign-up service releases it.",
                        release,
                    ),
                );
            } else if (record.partner) {
                box.append(
                    el("p", {
                        class: "si-hint",
                        text: `${record.partner} can approve or end this early from their recovery page.`,
                    }),
                );
            }
        } else {
            if (sponsored) {
                box.append(
                    action(
                        "Recover this account",
                        "Sign in the way you did when you created the account; your passkey then makes new keys.",
                        release,
                    ),
                );
            } else if (record.partner) {
                box.append(
                    action(
                        "Send new keys to the recovery partner",
                        `${record.partner} approves them from their recovery page.` +
                            (record.recoveryRequests.length
                                ? ` ${record.recoveryRequests.length} request${record.recoveryRequests.length === 1 ? " is" : "s are"} waiting.`
                                : ""),
                        () => void proposeKeys(name),
                    ),
                );
            } else {
                box.append(
                    el("p", { class: "si-hint", text: "No recovery partner: this freeze is permanent." }),
                );
            }
        }
        box.append(
            el("p", { class: "si-below" }, linkButton("Remove from this browser", () => void remove(name))),
        );
        return box;
    };

    const usageLine = async () => {
        try {
            const res = await fetch(`${net.siblingOrigin("x-usage")}/me`, {
                headers: { Authorization: `Bearer ${net.token}` },
            });
            if (!res.ok) return undefined;
            const u = (await res.json()) as Usage;
            return el(
                "div",
                { class: "si-panel" },
                el("p", { class: "si-label", text: "What you have used on this node" }),
                row("Requests", u.requests.toLocaleString()),
                row("Time", `${(u.elapsed_us / 1000).toFixed(1)} ms`),
                row("Sent / received", `${bytes(u.request_bytes)} / ${bytes(u.response_bytes)}`),
                el("p", {
                    class: "si-hint",
                    text: "Totals only. Nothing is charged for yet.",
                }),
            );
        } catch {
            return undefined;
        }
    };

    const render = async () => {
        const device = loadDevice();
        $("mg-title").textContent = "Your accounts";
        $("mg-lede").textContent = device.accounts.length
            ? "Each account has its own keys, all made by your passkey."
            : "This browser has no accounts yet.";
        const parts: Node[] = [];
        if (!device.accounts.some((a) => a.name === selected)) {
            selected = device.current ?? device.accounts[0]?.name ?? "";
        }
        for (const account of device.accounts) {
            const record = await fetchRecord(authOrigin, account.name, net.token).catch(
                () => undefined,
            );
            const open = account.name === selected;
            const head = el(
                "button",
                { class: "si-acct" + (open ? " si-open" : ""), type: "button" },
                el("span", { class: "si-avatar", text: account.name[0].toUpperCase() }),
                el(
                    "span",
                    { class: "si-dest-text" },
                    el("span", { class: "si-dest-host", text: account.name }),
                    el("span", {
                        class: "si-dest-label",
                        text: record ? stateText(record) : "Not found on the network",
                    }),
                ),
            );
            head.addEventListener("click", () => {
                selected = open ? "" : account.name;
                notice();
                void render();
            });
            parts.push(head);
            if (open && record) parts.push(detail(account.name, record));
        }
        const usage = await usageLine();
        if (usage) parts.push(usage);
        body.replaceChildren(...parts);
        setLinks($("mg-below"), [
            { label: "Back", run: () => ctx.go("account") },
            { label: "Create another account", run: () => ctx.go("account", { intent: "new" }) },
            { label: "Recover an account", run: () => ctx.go("account", { intent: "recover" }) },
        ]);
        ctx.show("manage");
    };

    await render();
};

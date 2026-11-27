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
    exportedKeyPem,
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
    recordAccount,
    rememberOnDevice,
} from "./device";
import { pushAsOwner } from "./owner-tx";
import { type Unlocked } from "./passkey";

// What x-usage reports for the caller (packages/local/XUsage). The node
// measures by connection identity: the account a login token names,
// otherwise the address.
interface Usage {
    enabled: boolean;
    identity: string;
    usage?: {
        total: {
            requests: number | string;
            bytesIn: number | string;
            bytesOut: number | string;
            requestNs: number | string;
        };
    } | null;
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
                await adoptFor("supervisor", name, privateKeyPem(next));
                rememberOnDevice(entry, false);
                await recordAccount(net, unlocked, entry).catch((e) => console.warn(e));
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

    // --------------------------------------------------------- export
    //
    // The account's signing (active) key as an ordinary key file, for the
    // command-line tool, a bot, or signing when no browser is at hand
    // (gofractally/psibase#2275, use case U10). It is derived again from the
    // passkey, held in this page while the panel is open, and never stored.
    // The owner key is not exported: a copy of it in a file would outlive
    // the moment the passkey was used, which is the one thing it must not do.
    let exported: { name: string; pem: string; seq: string } | undefined;

    const closeExport = () => {
        exported = undefined;
        void render();
    };

    const exportKey = async (name: string) => {
        notice();
        let unlocked: Unlocked | undefined;
        try {
            unlocked = await ctx.unlock(
                "Confirm with your passkey",
                `Exporting the signing key of ${name}.`,
            );
            const found = await keysFor(net, unlocked, name);
            if (!found) {
                throw new Error(`This passkey does not hold the owner key of ${name}.`);
            }
            // The signing key is derived from the owner secret, which is
            // wiped as soon as the file's contents are made.
            const active = activeSecret(
                unlocked.chainId,
                found.keys.ownerSecret,
                accountNumber(name),
                found.record.active.seq,
            );
            found.keys.ownerSecret.fill(0);
            exported = { name, pem: exportedKeyPem(active), seq: found.keys.active.seq };
            active.fill(0);
            await render();
        } catch (e) {
            await render();
            if (!ctx.isCancelled(e)) {
                notice(e instanceof Error ? e.message : "Something went wrong.");
            }
        } finally {
            unlocked?.wipe();
        }
    };

    const exportPanel = (key: { name: string; pem: string; seq: string }) => {
        const file = `${key.name}.active.pem`;
        const panel = el("div", { class: "si-panel si-export" });
        const download = el("button", {
            class: "si-btn si-primary",
            text: "Download key file",
            type: "button",
        });
        download.addEventListener("click", () => {
            const url = URL.createObjectURL(
                new Blob([key.pem], { type: "application/x-pem-file" }),
            );
            const link = el("a");
            link.href = url;
            link.download = file;
            document.body.append(link);
            link.click();
            link.remove();
            // The download has its own copy by now.
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
            saved.hidden = false;
        });
        const copy = el("button", { class: "si-btn si-ghost", text: "Copy to clipboard", type: "button" });
        copy.addEventListener("click", () => {
            void navigator.clipboard.writeText(key.pem).then(
                () => (copy.textContent = "Copied"),
                () => (copy.textContent = "Could not copy"),
            );
        });
        const saved = el("p", {
            class: "si-hint",
            text: `Saved as ${file}. Keep it somewhere only you can read.`,
        });
        saved.hidden = true;
        const command = el("pre", { class: "si-code" });
        const node = `${window.location.protocol}//${window.location.host.split(".").slice(1).join(".")}`;
        command.textContent = `psibase push -a ${node} -s ${file} actions.json`;
        const done = el("button", { class: "si-btn si-ghost", text: "Done", type: "button" });
        done.addEventListener("click", closeExport);
        panel.append(
            el("h2", { class: "si-panel-title", text: `Signing key of ${key.name}` }),
            el("p", {
                class: "si-hint",
                text: `Anyone with this file can act as ${key.name}: send transactions and sign in. It cannot change the owner key or the recovery partner, and it stops working when you choose "Sign out other devices". This is signing key number ${key.seq}.`,
            }),
            el("div", { class: "si-actions" }, download, copy),
            saved,
            el("p", { class: "si-label", text: "Use it with the command-line tool" }),
            command,
            el("p", {
                class: "si-hint",
                text: "The file is not protected by a password. The key is gone from this page when you press Done or leave.",
            }),
            done,
        );
        return panel;
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

    // The account's everyday controls are on the first tab; pausing,
    // freezing and the recovery partner are kept apart on the second, so
    // nobody meets them by accident.
    let tab: "account" | "security" | undefined;

    const detail = (name: string, record: ChainRecord) => {
        const troubled = record.state !== "normal";
        // An account that is paused or frozen opens on what can be done about it.
        const shown = tab ?? (troubled ? "security" : "account");
        const panel = el("div", { class: "si-panel" });
        const tabs = el("div", { class: "si-tabs" });
        for (const [id, label] of [
            ["account", "Account"],
            ["security", "Security"],
        ] as const) {
            const button = el("button", {
                class: "si-tab" + (shown === id ? " si-current" : ""),
                text: label,
                type: "button",
            });
            if (id === "security" && troubled) {
                button.append(el("span", { class: "si-flag", text: "●" }));
            }
            button.addEventListener("click", () => {
                tab = id;
                notice();
                void render();
            });
            tabs.append(button);
        }
        const facts = el("div", { class: "si-facts" });
        // The actions sit side by side where there is room for them.
        const box = el("div", { class: "si-actions" });
        panel.append(el("h2", { class: "si-panel-title", text: name }), tabs, facts, box);

        const sponsored = !!sponsor && record.partner === sponsor;
        const release = () => ctx.go("account", { intent: "recover", account: name });

        if (shown === "account") {
            facts.append(
                row("State", stateText(record)),
                row("Signing key", `number ${record.active.seq}`),
            );
            if (!troubled) {
                box.append(
                    action(
                        "Sign out other devices",
                        "Replaces the key devices sign with. Use it if a device was lost.",
                        () => void rotateActive(name),
                    ),
                    action(
                        "Export signing key",
                        "A key file for the command-line tool or a bot. It can sign as this account but cannot change who controls it.",
                        () => void exportKey(name),
                    ),
                );
            } else {
                facts.append(
                    el("p", {
                        class: "si-hint",
                        text: `Nothing can be done as ${name} for now. See Security.`,
                    }),
                );
            }
            panel.append(
                el(
                    "p",
                    { class: "si-below" },
                    linkButton("Remove from this browser", () => void remove(name)),
                ),
            );
            return panel;
        }

        facts.append(
            row("Recovery partner", partnerName(record.partner)),
            row("State", stateText(record)),
            row("Pause length", duration(record.pauseSeconds)),
            row("Freeze window", duration(record.freezeSeconds)),
        );
        const pending = pendingText(record);
        if (pending) {
            facts.append(
                row("Waiting", pending),
                el("p", {
                    class: "si-hint",
                    text: `Takes effect ${when(record.stateUntil)}, or as soon as the recovery partner approves.`,
                }),
            );
        }

        if (record.state === "normal") {
            box.append(
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
            const submit = el("button", {
                class: "si-btn si-ghost",
                text: "Change recovery partner",
                type: "submit",
            });
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
        } else if (sponsored) {
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
        return panel;
    };

    const usageLine = async () => {
        try {
            const res = await fetch(`${net.siblingOrigin("x-usage")}/me`, {
                headers: { Authorization: `Bearer ${net.token}` },
            });
            if (!res.ok) return undefined;
            const u = (await res.json()) as Usage;
            if (!u.enabled) return undefined;
            const t = u.usage?.total;
            const n = (v: number | string | undefined) => Number(v ?? 0);
            return el(
                "div",
                { class: "si-panel" },
                el("p", { class: "si-label", text: "What you have used on this node" }),
                row("Counted as", u.identity),
                row("Requests", n(t?.requests).toLocaleString()),
                row("Time", `${(n(t?.requestNs) / 1e6).toFixed(1)} ms`),
                row("Sent / received", `${bytes(n(t?.bytesIn))} / ${bytes(n(t?.bytesOut))}`),
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
        if (!device.accounts.some((a) => a.name === selected)) {
            selected = device.current ?? device.accounts[0]?.name ?? "";
        }
        // Two columns on a wide screen: the accounts and usage on the left,
        // the selected account on the right. One column on a narrow one.
        const side = el("div", { class: "si-stack" });
        const main = el("div", { class: "si-stack" });
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
                if (open) return;
                selected = account.name;
                tab = undefined;
                exported = undefined;
                notice();
                void render();
            });
            side.append(head);
            if (open && record) {
                // While a key is on show nothing else is, so it cannot be
                // left behind a tab.
                main.append(
                    exported?.name === account.name
                        ? exportPanel(exported)
                        : detail(account.name, record),
                );
            }
        }
        const usage = await usageLine();
        if (usage) side.append(usage);
        body.replaceChildren(side, ...(main.childElementCount ? [main] : []));
        setLinks($("mg-below"), [
            { label: "Back", run: () => ctx.go("account") },
            { label: "Create another account", run: () => ctx.go("account", { intent: "new" }) },
            { label: "Recover an account", run: () => ctx.go("account", { intent: "recover" }) },
        ]);
        ctx.show("manage");
    };

    await render();
};

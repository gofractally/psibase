// Accounts: choosing one, creating one, getting one back.
//
// Creating (gofractally/psibase#2275):
//   1. Passkey   — already done: the visitor is a guest.
//   2. Verify    — a sign-in provider vouches for the visitor, which makes
//                  them eligible for an account. The node keeps the
//                  provider's stable user id and handle, never its tokens.
//   3. Name      — the visitor picks a name and confirms with the passkey,
//                  which derives the account's owner and active keys. Only
//                  the two public keys leave this page; the node's sponsor
//                  signs the transaction that creates the account and
//                  becomes its recovery partner.
//
// The active key then goes into the supervisor's key store, the account is
// added to the passkey's encrypted account list, and the owner key is wiped.
import { accountKeys, sha256Hex } from "./account-keys";
import {
    ANY_NAME_RULE,
    NAME_RULE,
    type PageContext,
    pushPrepared,
    setLinks,
} from "./context";
import {
    type ChainRecord,
    adoptFor,
    fetchRecord,
    keysFor,
    callPlugin,
    loadDevice,
    loginFor,
    recordAccount,
    refreshPasskeyLabel,
    rememberOnDevice,
    sameKey,
    setCurrent,
} from "./device";
import { type Unlocked } from "./passkey";

interface LinkInfo {
    provider: string;
    handle: string;
    account?: string | null;
    pending?: string | null;
}

interface Status {
    open: boolean;
    providers: { name: string; label: string }[];
    guest: string;
    link?: LinkInfo | null;
    accounts?: string[];
    sponsor?: string | null;
    recovery?: { account: string; valid_seconds: number } | null;
}

const SECRET_KEY = "psibase.sign-in.provider-secret";

type Intent = "" | "new" | "recover";

export const runAccountStep = async (ctx: PageContext) => {
    const { $, session, net } = ctx;
    const signup = net.siblingOrigin("x-signup");
    const transact = net.siblingOrigin("transact");
    const params = new URLSearchParams(window.location.search);
    const intent = (params.get("intent") ?? "") as Intent;
    const subject = params.get("account") ?? "";

    const api = async <T>(path: string, body?: unknown): Promise<T> => {
        const res = await fetch(signup + path, {
            method: body === undefined ? "GET" : "POST",
            headers: {
                Authorization: `Bearer ${session.token}`,
                ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        }).catch(() => {
            throw new Error("Could not reach the network. Try again.");
        });
        const text = await res.text();
        let parsed: unknown;
        try {
            parsed = text ? JSON.parse(text) : {};
        } catch {
            parsed = {};
        }
        if (!res.ok) {
            throw new Error(
                (parsed as { error?: string }).error ?? "Something went wrong. Try again.",
            );
        }
        return parsed as T;
    };

    const notice = (message?: string) => {
        const node = $("acct-notice");
        node.hidden = !message;
        node.textContent = message ?? "";
    };
    const report = (e: unknown) => {
        if (!ctx.isCancelled(e)) notice(e instanceof Error ? e.message : undefined);
    };

    // The progress strip belongs to creating an account; someone who
    // already has one is not partway through anything.
    const steps = (current: 2 | 3 | "none") => {
        const strip = $("acct-step-1").parentElement as HTMLElement;
        strip.hidden = current === "none";
        if (current === "none") return;
        for (const n of [1, 2, 3]) {
            const node = $(`acct-step-${n}`);
            node.classList.toggle("si-done", n < current);
            node.classList.toggle("si-current", n === current);
        }
    };

    /** Clears the view to its title and text; each view then adds its parts. */
    const frame = (title: string, lede: string, step: 2 | 3 | "none" = "none") => {
        steps(step);
        $("acct-title").textContent = title;
        $("acct-lede").textContent = lede;
        for (const id of ["acct-providers", "acct-name-form", "acct-list", "acct-more"]) {
            $(id).hidden = true;
        }
        ctx.show("account");
    };

    const guestLink = { label: "Stay a guest", run: () => void ctx.enterApp() };
    const backLink = { label: "Back", run: () => ctx.go("account") };
    const links = (...items: { label: string; run: () => void }[]) =>
        setLinks($("acct-below"), items);

    // -------------------------------------------------------- chooser

    const showChooser = () => {
        const device = loadDevice();
        const single = device.accounts.length === 1;
        frame(
            single ? `Welcome back, ${device.accounts[0].name}` : "Choose an account",
            `Use it on ${ctx.app}.${ctx.rootName}.`,
        );
        const list = $("acct-list");
        list.textContent = "";
        const ordered = [...device.accounts].sort(
            (a, b) => Number(b.name === device.current) - Number(a.name === device.current),
        );
        for (const account of ordered) {
            const button = document.createElement("button");
            button.type = "button";
            button.className =
                account.name === device.current ? "si-btn si-primary" : "si-btn si-provider";
            button.textContent = `Continue as ${account.name}`;
            button.addEventListener("click", () => void enter(account.name));
            list.append(button);
        }
        list.hidden = false;
        links(guestLink, { label: "Manage accounts", run: () => ctx.go("manage") });
        setLinks($("acct-more"), [
            { label: "Create another account", run: () => ctx.go("account", { intent: "new" }) },
            { label: "Recover an account", run: () => ctx.go("account", { intent: "recover" }) },
        ]);
    };

    const enter = async (name: string) => {
        notice();
        const entry = loadDevice().accounts.find((a) => a.name === name);
        if (entry?.held === false) return ctx.go("manage", { account: name });
        try {
            ctx.working("Signing you in", `as ${name}`);
            setCurrent(name);
            await ctx.enterApp(name);
        } catch (e) {
            console.error(e);
            showChooser();
            notice(
                `${name} could not be signed in. If it is paused or frozen, open Manage accounts.`,
            );
        }
    };

    // ------------------------------------------------------- creating

    const showClosed = () => {
        frame(
            "Accounts aren't open yet",
            "This network isn't creating new accounts right now. You can keep looking around as a guest.",
            2,
        );
        links({ label: `Back to ${ctx.app}`, run: () => void ctx.enterApp() });
    };

    const providerButtons = (
        status: Status,
        start: (provider: string) => void,
    ) => {
        const list = $("acct-providers");
        list.textContent = "";
        for (const provider of status.providers) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "si-btn si-provider";
            button.textContent =
                provider.name === "dev" ? provider.label : `Continue with ${provider.label}`;
            button.addEventListener("click", () => start(provider.name));
            list.append(button);
        }
        list.hidden = false;
    };

    const showProviders = (status: Status) => {
        frame(
            "Create your account",
            "First, show you're a real person. We only keep your public handle, to give each person one account.",
            2,
        );
        providerButtons(status, (p) => void startProvider(p, {}));
        links(guestLink, { label: "Recover an account", run: () => ctx.go("account", { intent: "recover" }) });
    };

    // The name form serves three questions; `submitName` is the current one.
    let submitName: (name: string) => void = () => {};
    let nameRule = NAME_RULE;
    let checkName: ((name: string) => Promise<{ ok: boolean; problem: string }>) | undefined;
    let nameOk = false;
    let checkSeq = 0;
    let checkTimer: number | undefined;

    const setHint = (text: string, bad = false) => {
        const hint = $("acct-name-hint");
        hint.textContent = text;
        hint.classList.toggle("si-bad", bad);
    };

    const validateName = () => {
        const value = $<HTMLInputElement>("acct-name").value;
        const shapeOk = nameRule.test(value) && !value.endsWith("-");
        const button = $<HTMLButtonElement>("acct-create");
        nameOk = false;
        button.disabled = true;
        window.clearTimeout(checkTimer);
        const seq = ++checkSeq;
        if (value.length === 0) {
            setHint(
                nameRule === NAME_RULE
                    ? "8 to 10 lowercase letters, digits or hyphens, starting with a letter."
                    : "",
            );
            return;
        }
        if (!shapeOk) {
            const short = nameRule === NAME_RULE && value.length < 8;
            setHint(
                short
                    ? `${8 - value.length} more character${value.length === 7 ? "" : "s"} needed.`
                    : "Use lowercase letters, digits and hyphens, starting with a letter.",
                !short,
            );
            return;
        }
        if (!checkName) {
            nameOk = true;
            button.disabled = false;
            setHint("");
            return;
        }
        setHint("Checking…");
        const check = checkName;
        checkTimer = window.setTimeout(async () => {
            try {
                const reply = await check(value);
                if (seq !== checkSeq) return;
                nameOk = reply.ok;
                setHint(reply.ok ? `${value} is available.` : reply.problem, !reply.ok);
                button.disabled = !reply.ok;
            } catch (e) {
                if (seq !== checkSeq) return;
                setHint(e instanceof Error ? e.message : "Could not check that name.", true);
            }
        }, 250);
    };

    const nameForm = (options: {
        label: string;
        button: string;
        rule: RegExp;
        check?: (name: string) => Promise<{ ok: boolean; problem: string }>;
        suggestion?: string;
        submit: (name: string) => void;
    }) => {
        $("acct-name-label").textContent = options.label;
        $("acct-create").textContent = options.button;
        nameRule = options.rule;
        checkName = options.check;
        submitName = options.submit;
        const input = $<HTMLInputElement>("acct-name");
        if (!input.value && options.suggestion && options.rule.test(options.suggestion)) {
            input.value = options.suggestion;
        }
        $("acct-name-form").hidden = false;
        validateName();
        input.focus();
    };

    const availability = (name: string) =>
        api<{ ok: boolean; problem: string }>(`/check_name?name=${encodeURIComponent(name)}`);

    /** `link`: the provider sign-in behind a sponsored account. `by`: the visitor's own account that creates it. */
    const showName = (link: LinkInfo | undefined, by?: string) => {
        creator = by;
        if (by) {
            frame(
                "Name your new account",
                `${by} creates it and becomes its recovery partner, which you can change afterwards. The name can't be changed later.`,
            );
        } else {
            frame(
                "Choose your name",
                !link || link.provider === "dev"
                    ? "This is how others will see you. It can't be changed later."
                    : `Verified as ${link.handle}. Now pick how others will see you here. It can't be changed later.`,
                3,
            );
        }
        nameForm({
            label: "Your name on this network",
            button: "Create account",
            rule: NAME_RULE,
            check: availability,
            // The name picked when the passkey was made, if it is still
            // wanted; otherwise something like the provider's handle.
            suggestion: by
                ? undefined
                : (loadDevice().pendingName ??
                  link?.handle
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "")
                      .replace(/^[^a-z]+/, "")
                      .slice(0, 10)),
            submit: (name) => void create(name),
        });
        links(by ? backLink : guestLink);
    };

    // -------------------------------------------------------- provider

    const resumeQuery = (extra: Record<string, string>) =>
        new URLSearchParams({ app: ctx.app, path: ctx.path, ...extra }).toString();

    const startProvider = async (provider: string, purpose: { account?: string }) => {
        notice();
        try {
            ctx.working("One moment");
            const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
                b.toString(16).padStart(2, "0"),
            ).join("");
            window.sessionStorage.setItem(SECRET_KEY, secret);
            const recovering = purpose.account !== undefined;
            const reply = await api<{
                url: string;
                recovery?: { account: string } | null;
            }>("/oauth/start", {
                provider,
                browser: sha256Hex(secret),
                resume: resumeQuery(
                    recovering ? { intent: "recover", account: purpose.account! } : {},
                ),
                ...(recovering ? { purpose: "recover", account: purpose.account } : {}),
            });
            if (reply.url) {
                window.location.assign(reply.url);
                return;
            }
            // A provider that answers at once (the development one).
            if (recovering) await recover(purpose.account!, !!reply.recovery);
            else await refresh();
        } catch (e) {
            if (purpose.account !== undefined) await recover(purpose.account, false);
            else await refresh();
            report(e);
        }
    };

    const finishProvider = async (state: string) => {
        ctx.working("Checking your sign-in");
        const secret = window.sessionStorage.getItem(SECRET_KEY) ?? "";
        window.sessionStorage.removeItem(SECRET_KEY);
        // Drop the one-time value from the address bar and history.
        const kept = new URLSearchParams(window.location.search);
        kept.delete("state");
        window.history.replaceState(null, "", `${window.location.pathname}?${kept}`);
        await api("/oauth/finish", { state, secret });
    };

    // ------------------------------------------------------- creation

    /** Waits until queries show `name` with this owner key. */
    const untilVisible = async (name: string, ownerKey: string) => {
        for (let i = 0; i < 40; ++i) {
            const record = await fetchRecord(
                net.siblingOrigin("auth-sig"),
                name,
                net.token,
            ).catch(() => undefined);
            if (record && sameKey(record.owner.key, ownerKey)) return record;
            await new Promise((r) => setTimeout(r, 500));
        }
        throw new Error(
            `${name} was submitted but has not appeared yet. Reload this page in a moment.`,
        );
    };

    /** Stores the key, lists the account under the passkey and goes to the app. */
    const settle = async (
        unlocked: Unlocked,
        name: string,
        keys: ReturnType<typeof accountKeys>,
    ) => {
        ctx.working("Signing you in", `as ${name}`);
        const entry = { name, ownerSeq: keys.owner.seq, activeSeq: keys.active.seq };
        try {
            await adoptFor(ctx.app, name, keys.activePem);
        } catch (e) {
            console.error(e);
            throw new Error(
                `Your account ${name} exists, but this browser could not be signed in to it. Try again from Recover an account.`,
            );
        }
        rememberOnDevice(entry, true);
        // Without this a new device would not find the account by itself;
        // it can still be found by name from "Recover an account".
        await recordAccount(net, unlocked, entry).catch((e) => console.warn(e));
        // The password manager now shows the passkey under the account's name.
        await refreshPasskeyLabel();
        $("done-detail").textContent = `You're ${name} now`;
        ctx.show("done");
        await new Promise((r) => setTimeout(r, 900));
        await ctx.enterApp(name, true);
    };

    // Who creates the account: the network's sponsor, for a visitor a
    // sign-in provider vouched for, or one of the visitor's own accounts.
    let creator: string | undefined;

    const create = async (name: string) => {
        notice();
        let unlocked: Unlocked | undefined;
        let keys: ReturnType<typeof accountKeys> | undefined;
        try {
            unlocked = await ctx.unlock(
                "Confirm with your passkey",
                `Your passkey makes the keys for ${name}.`,
                name,
            );
            keys = accountKeys(unlocked.chainId, unlocked.root, name, 0n, 0n);
            ctx.working("Creating your account", `Reserving ${name}`);
            try {
                if (creator) {
                    // The page acts as the creating account for this one call.
                    await loginFor("supervisor", creator);
                    await callPlugin({
                        service: "auth-sig",
                        plugin: "plugin",
                        intf: "actions",
                        method: "createAccountWith",
                        params: [name, keys.owner.key, 0, keys.active.key, 0],
                    });
                } else {
                    const reply = await api<{ transaction: string }>("/create", {
                        name,
                        owner: keys.owner,
                        active: keys.active,
                    });
                    await pushPrepared(transact, reply.transaction);
                }
            } catch (e) {
                throw new Error(
                    "The network did not create the account: " +
                        ((e as Error)?.message ?? String(e)),
                );
            }
            await untilVisible(name, keys.owner.key);
            await settle(unlocked, name, keys);
        } catch (e) {
            await refresh();
            report(e);
        } finally {
            keys?.ownerSecret.fill(0);
            unlocked?.wipe();
        }
    };

    // ------------------------------------------------------- recovery

    const showRecoverName = () => {
        frame(
            "Recover an account",
            "Enter the account's name. If this passkey controls it, it is added to this browser. If it is paused or frozen, its recovery partner can release it.",
        );
        nameForm({
            label: "Account name",
            button: "Continue",
            rule: ANY_NAME_RULE,
            suggestion: subject,
            submit: (name) => void recover(name, false),
        });
        links(loadDevice().accounts.length ? backLink : guestLink);
    };

    const describe = (record: ChainRecord) =>
        record.state === "frozen"
            ? "is frozen"
            : record.pending
              ? "is paused with a change waiting"
              : record.state === "paused"
                ? "is paused"
                : "is in use";

    /**
     * Gets `name` back for this passkey. `granted` says the sponsor has just
     * accepted a provider sign-in for it.
     */
    const recover = async (name: string, granted: boolean) => {
        notice();
        let unlocked: Unlocked | undefined;
        try {
            ctx.working("Looking up " + name);
            const record = await fetchRecord(net.siblingOrigin("auth-sig"), name, net.token);
            if (!record) {
                showRecoverName();
                notice(`There is no account named ${name} that a key controls.`);
                return;
            }
            const status = await api<Status>("/status");
            const sponsored = !!status.sponsor && record.partner === status.sponsor;
            granted = granted || status.recovery?.account === name;

            if (record.state === "normal") {
                // Nothing for a partner to do: either this passkey holds the
                // account, or another one does.
                unlocked = await ctx.unlock(
                    "Confirm with your passkey",
                    `Checking whether it controls ${name}.`,
                    name,
                );
                const found = await keysFor(net, unlocked, name);
                if (found) {
                    found.keys.ownerSecret.fill(0);
                    await settle(unlocked, name, found.keys);
                    return;
                }
                frame(
                    `${name} belongs to another passkey`,
                    `${name} is in use and this passkey does not control it. A recovery partner can only act on an account that has been paused or frozen with one of its own keys.`,
                );
                links(backLink);
                return;
            }

            if (!sponsored) {
                frame(
                    `${name} ${describe(record)}`,
                    record.partner
                        ? `Its recovery partner is ${record.partner}. Ask them to open their recovery page and approve; ${name} can send them its new keys from Manage accounts.`
                        : `${name} has no recovery partner, so nobody can release it.`,
                );
                links(backLink);
                return;
            }

            if (!granted) {
                frame(
                    `${name} ${describe(record)}`,
                    "This network's sign-up service is its recovery partner. Sign in the way you did when you created the account, and it will release it.",
                );
                providerButtons(status, (p) => void startProvider(p, { account: name }));
                links(backLink);
                return;
            }

            if (record.state === "frozen") {
                unlocked = await ctx.unlock(
                    "Confirm with your passkey",
                    `It makes new keys for ${name}.`,
                    name,
                );
                // A sequence value the account has not used, so the keys are
                // new even under the passkey it had before.
                const keys = accountKeys(
                    unlocked.chainId,
                    unlocked.root,
                    name,
                    record.owner.seq + 1n,
                    0n,
                );
                try {
                    ctx.working("Releasing " + name, "Installing your new keys");
                    const reply = await api<{ transaction: string }>("/partner/unfreeze", {
                        account: name,
                        owner: keys.owner,
                        active: keys.active,
                    });
                    await pushPrepared(transact, reply.transaction);
                    await untilVisible(name, keys.owner.key);
                    await settle(unlocked, name, keys);
                } finally {
                    keys.ownerSecret.fill(0);
                }
                return;
            }

            // Paused: confirm the change that is waiting, or just end the pause.
            ctx.working("Releasing " + name);
            const reply = await api<{ transaction: string }>(
                record.pending ? "/partner/confirm" : "/partner/end-pause",
                { account: name },
            );
            await pushPrepared(transact, reply.transaction);
            await new Promise((r) => setTimeout(r, 1500));
            await recover(name, false);
        } catch (e) {
            showRecoverName();
            report(e);
        } finally {
            unlocked?.wipe();
        }
    };

    // --------------------------------------------------------- wiring

    // Shows whatever comes next for this guest.
    const refresh = async () => {
        if (intent === "recover") return showRecoverName();
        if (intent !== "new" && loadDevice().accounts.length) return showChooser();
        const status = await api<Status>("/status");
        const device = loadDevice();
        const own = device.accounts.find((a) => a.name === device.current && a.held !== false);
        if (status.link?.account) {
            // The provider sign-in already has its account. If this browser
            // does not hold it yet, bring it here first.
            if (!device.accounts.some((a) => a.name === status.link!.account)) {
                return recover(status.link.account, false);
            }
            // A further account is created by one the visitor already has.
            if (own) return showName(undefined, own.name);
            return showChooser();
        }
        if (intent === "new" && own && !status.link) return showName(undefined, own.name);
        if (!status.open) return showClosed();
        if (status.link) return showName(status.link);
        if (status.providers.length === 0) return showClosed();
        return showProviders(status);
    };

    $<HTMLInputElement>("acct-name").addEventListener("input", (e) => {
        const input = e.target as HTMLInputElement;
        const cleaned = input.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (cleaned !== input.value) input.value = cleaned;
        validateName();
    });
    $("acct-name-form").addEventListener("submit", (e) => {
        e.preventDefault();
        if (nameOk) submitName($<HTMLInputElement>("acct-name").value);
    });

    try {
        const state = params.get("state");
        const providerError = params.get("provider_error");
        if (state) await finishProvider(state);
        if (intent === "recover" && subject) {
            // Sent here for one account: no need to ask its name again.
            await recover(subject, !!state);
        } else {
            await refresh();
        }
        if (providerError) {
            notice(
                providerError === "cancelled"
                    ? "The sign-in was cancelled."
                    : "That sign-in took too long. Try again.",
            );
        }
    } catch (e) {
        await refresh().catch(() => showClosed());
        report(e);
    }
};

// A guest becomes a named account.
//
//   1. Passkey   — already done: the visitor is a guest.
//   2. Verify    — a sign-in provider vouches for the visitor, which makes
//                  them eligible for one account. The node keeps the
//                  provider's stable user id and handle, never its tokens.
//   3. Name      — the visitor picks a name. The node's sponsor signs a
//                  transaction creating the account with the visitor's own
//                  passkey-derived key; this page submits it.
//
// Then the key goes into the supervisor's key store and the account becomes
// the signed-in user for the app the visitor came from.
import { type GuestSession } from "../guest-session";
import {
    guestKeyFrom,
    hexToBytes,
    privateKeyPem,
    sha256Hex,
} from "./guest-key";

export interface AccountContext {
    session: GuestSession;
    app: string;
    path: string;
    rootName: string;
    siblingOrigin: (service: string) => string;
    $: <T extends HTMLElement>(id: string) => T;
    show: (view: "account" | "working" | "done") => void;
    working: (title: string, detail?: string) => void;
    /** Asks for the passkey and returns its secret. */
    unlock: () => Promise<Uint8Array>;
    fetchChainId: () => Promise<string>;
    /** Sends the visitor back to the app as a guest. */
    leaveAsGuest: () => void;
    isCancelled: (e: unknown) => boolean;
}

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
}

const SECRET_KEY = "psibase.sign-in.provider-secret";
const NAME_RULE = /^[a-z][a-z0-9-]{7,17}$/;

export const runAccountStep = async (ctx: AccountContext) => {
    const { $, session } = ctx;
    const signup = ctx.siblingOrigin("x-signup");
    const params = new URLSearchParams(window.location.search);

    const api = async <T>(
        path: string,
        body?: unknown,
    ): Promise<T> => {
        const res = await fetch(signup + path, {
            method: body === undefined ? "GET" : "POST",
            headers: {
                Authorization: `Bearer ${session.token}`,
                ...(body === undefined
                    ? {}
                    : { "Content-Type": "application/json" }),
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
                (parsed as { error?: string }).error ??
                    "Something went wrong. Try again.",
            );
        }
        return parsed as T;
    };

    const notice = (message?: string) => {
        const el = $("acct-notice");
        el.hidden = !message;
        el.textContent = message ?? "";
    };

    const steps = (current: 2 | 3 | 4) => {
        for (const n of [1, 2, 3]) {
            const el = $(`acct-step-${n}`);
            el.classList.toggle("si-done", n < current);
            el.classList.toggle("si-current", n === current);
        }
    };

    const resumeQuery = () =>
        new URLSearchParams({ app: ctx.app, path: ctx.path }).toString();

    // ------------------------------------------------------------ views

    const showClosed = () => {
        steps(2);
        $("acct-title").textContent = "Accounts aren't open yet";
        $("acct-lede").textContent =
            "This network isn't creating new accounts right now. You can keep looking around as a guest.";
        $("acct-providers").hidden = true;
        $("acct-name-form").hidden = true;
        $("acct-continue").hidden = true;
        $("acct-later").textContent = "Back to " + ctx.app;
        ctx.show("account");
    };

    const showProviders = (status: Status) => {
        steps(2);
        $("acct-title").textContent = "Create your account";
        $("acct-lede").textContent =
            "First, show you're a real person. We only keep your public handle, to give each person one account.";
        const list = $("acct-providers");
        list.textContent = "";
        for (const provider of status.providers) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "si-btn si-provider";
            button.textContent =
                provider.name === "dev"
                    ? provider.label
                    : `Continue with ${provider.label}`;
            button.addEventListener(
                "click",
                () => void startProvider(provider.name),
            );
            list.append(button);
        }
        list.hidden = false;
        $("acct-name-form").hidden = true;
        $("acct-continue").hidden = true;
        ctx.show("account");
    };

    const showName = (link: LinkInfo) => {
        steps(3);
        $("acct-title").textContent = "Choose your name";
        $("acct-lede").textContent =
            link.provider === "dev"
                ? "This is how others will see you. It can't be changed later."
                : `Verified as ${link.handle}. Now pick how others will see you here. It can't be changed later.`;
        $("acct-providers").hidden = true;
        $("acct-continue").hidden = true;
        const input = $<HTMLInputElement>("acct-name");
        if (!input.value) {
            const suggestion = link.handle
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, "")
                .replace(/^[^a-z]+/, "")
                .slice(0, 18);
            if (NAME_RULE.test(suggestion)) input.value = suggestion;
        }
        $("acct-name-form").hidden = false;
        validateName();
        ctx.show("account");
        input.focus();
    };

    const showContinue = (account: string) => {
        steps(4);
        $("acct-title").textContent = `Welcome, ${account}`;
        $("acct-lede").textContent =
            "Your account is ready. Confirm with your passkey to use it here.";
        $("acct-providers").hidden = true;
        $("acct-name-form").hidden = true;
        const button = $("acct-continue");
        button.textContent = `Continue as ${account}`;
        button.hidden = false;
        button.onclick = () => void adopt(account);
        ctx.show("account");
    };

    // The form checks the shape; the node says whether the name fits the
    // network's name encoding and is free.
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
        const shapeOk = NAME_RULE.test(value) && !value.endsWith("-");
        nameOk = false;
        $<HTMLButtonElement>("acct-create").disabled = true;
        window.clearTimeout(checkTimer);
        const seq = ++checkSeq;
        if (value.length === 0) {
            setHint("Lowercase letters, digits and hyphens, starting with a letter.");
            return;
        }
        if (!shapeOk) {
            setHint(
                value.length < 8
                    ? `${8 - value.length} more character${value.length === 7 ? "" : "s"} needed.`
                    : "Use lowercase letters, digits and hyphens, starting with a letter.",
                value.length >= 8,
            );
            return;
        }
        setHint("Checking…");
        checkTimer = window.setTimeout(async () => {
            try {
                const reply = await api<{ ok: boolean; problem: string }>(
                    `/check_name?name=${encodeURIComponent(value)}`,
                );
                if (seq !== checkSeq) return;
                nameOk = reply.ok;
                setHint(reply.ok ? `${value} is available.` : reply.problem, !reply.ok);
                $<HTMLButtonElement>("acct-create").disabled = !reply.ok;
            } catch (e) {
                if (seq !== checkSeq) return;
                setHint(e instanceof Error ? e.message : "Could not check that name.", true);
            }
        }, 250);
    };

    // ---------------------------------------------------------- actions

    const startProvider = async (provider: string) => {
        notice();
        try {
            ctx.working("One moment");
            const secret = Array.from(
                crypto.getRandomValues(new Uint8Array(32)),
                (b) => b.toString(16).padStart(2, "0"),
            ).join("");
            window.sessionStorage.setItem(SECRET_KEY, secret);
            const reply = await api<{ url: string; link?: LinkInfo | null }>(
                "/oauth/start",
                { provider, browser: sha256Hex(secret), resume: resumeQuery() },
            );
            if (reply.url) {
                window.location.assign(reply.url);
                return;
            }
            await refresh();
        } catch (e) {
            await refresh();
            notice(e instanceof Error ? e.message : undefined);
        }
    };

    const finishProvider = async (state: string) => {
        ctx.working("Checking your sign-in");
        const secret = window.sessionStorage.getItem(SECRET_KEY) ?? "";
        window.sessionStorage.removeItem(SECRET_KEY);
        // Drop the one-time value from the address bar and history.
        window.history.replaceState(
            null,
            "",
            `${window.location.pathname}?${resumeQuery()}&step=account`,
        );
        await api("/oauth/finish", { state, secret });
    };

    const create = async (name: string) => {
        notice();
        let secret: Uint8Array | undefined;
        try {
            ctx.working(
                "Confirm with your passkey",
                "Your account will use your passkey's key.",
            );
            secret = await ctx.unlock();
            const chainId = await ctx.fetchChainId();
            const key = guestKeyFrom(secret, chainId);
            if (key.publicKey !== session.publicKey) {
                throw new Error(
                    "That is a different passkey from the one you signed in with.",
                );
            }
            const pem = privateKeyPem(secret, chainId);

            ctx.working("Creating your account", `Reserving ${name}`);
            const reply = await api<{ transaction: string }>("/create", {
                name,
                key: key.publicKey,
            });
            const pushed = await fetch(
                `${ctx.siblingOrigin("transact")}/push_transaction?wait_for=applied`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/octet-stream",
                        Accept: "application/json",
                    },
                    body: new Blob([hexToBytes(reply.transaction).buffer as ArrayBuffer]),
                },
            );
            const trace = pushed.ok
                ? ((await pushed.json()) as { error?: string | null })
                : { error: await pushed.text() };
            if (trace.error) {
                throw new Error(
                    "The network did not create the account: " + trace.error,
                );
            }
            await untilVisible(name);
            await finishAdoption(name, pem);
        } catch (e) {
            await refresh();
            if (!ctx.isCancelled(e)) {
                notice(e instanceof Error ? e.message : undefined);
            }
        } finally {
            secret?.fill(0);
        }
    };

    // A transaction is acknowledged before queries can see its effects.
    // Wait until the node itself reports the account as this guest's.
    const untilVisible = async (name: string) => {
        for (let i = 0; i < 30; ++i) {
            const status = await api<Status>("/status");
            if (status.link?.account === name) return;
            await new Promise((r) => setTimeout(r, 500));
        }
        throw new Error(
            `${name} was submitted but has not appeared yet. Reload this page in a moment.`,
        );
    };

    const adopt = async (account: string) => {
        notice();
        let secret: Uint8Array | undefined;
        try {
            ctx.working("Confirm with your passkey");
            secret = await ctx.unlock();
            const chainId = await ctx.fetchChainId();
            if (guestKeyFrom(secret, chainId).publicKey !== session.publicKey) {
                throw new Error(
                    "That is a different passkey from the one you signed in with.",
                );
            }
            await finishAdoption(account, privateKeyPem(secret, chainId));
        } catch (e) {
            await refresh();
            if (!ctx.isCancelled(e)) {
                notice(e instanceof Error ? e.message : undefined);
            }
        } finally {
            secret?.fill(0);
        }
    };

    // Puts the key in the supervisor's key store and signs the account in
    // to the app the visitor came from.
    const finishAdoption = async (account: string, pem: string) => {
        ctx.working("Signing you in", `as ${account}`);
        const { getSupervisor } = await import("@psibase/common-lib");
        // The key store looks the account up through its own query path,
        // which can trail the node's view by a block.
        let lastError: unknown;
        for (let attempt = 0; attempt < 8; ++attempt) {
            try {
                await getSupervisor().functionCall(
                    {
                        service: "host",
                        plugin: "accounts",
                        intf: "admin",
                        method: "adoptAccount",
                        params: [account, pem],
                    },
                    { enabled: false, returnPath: ctx.path },
                );
                lastError = undefined;
                break;
            } catch (e) {
                lastError = e;
                if (!String((e as Error)?.message ?? e).includes("not found")) {
                    break;
                }
                await new Promise((r) => setTimeout(r, 700));
            }
        }
        if (lastError) {
            console.error(lastError);
            throw new Error(
                `Your account ${account} exists, but this browser could not be signed in to it. Open the app and choose Connect account to try again.`,
            );
        }
        $("done-detail").textContent = `You're ${account} now`;
        ctx.show("done");
        await new Promise((r) => setTimeout(r, 1000));
        window.location.assign(ctx.siblingOrigin(ctx.app) + ctx.path);
    };

    // Shows whatever comes next for this guest.
    const refresh = async () => {
        const status = await api<Status>("/status");
        if (status.link?.account) return showContinue(status.link.account);
        if (!status.open) return showClosed();
        if (status.link) return showName(status.link);
        if (status.providers.length === 0) return showClosed();
        return showProviders(status);
    };

    // ----------------------------------------------------------- wiring

    $("acct-later").addEventListener("click", () => ctx.leaveAsGuest());
    $("acct-classic").addEventListener("click", () => {
        window.location.assign(
            `/prompt.html?classic=1&returnPath=${encodeURIComponent(ctx.path)}`,
        );
    });
    $<HTMLInputElement>("acct-name").addEventListener("input", (e) => {
        const input = e.target as HTMLInputElement;
        const cleaned = input.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
        if (cleaned !== input.value) input.value = cleaned;
        validateName();
    });
    $("acct-name-form").addEventListener("submit", (e) => {
        e.preventDefault();
        if (nameOk) void create($<HTMLInputElement>("acct-name").value);
    });

    try {
        const state = params.get("state");
        const providerError = params.get("provider_error");
        if (state) await finishProvider(state);
        await refresh();
        if (providerError) {
            notice(
                providerError === "cancelled"
                    ? "The sign-in was cancelled."
                    : "That sign-in took too long. Try again.",
            );
        }
    } catch (e) {
        await refresh().catch(() => showClosed());
        notice(e instanceof Error ? e.message : undefined);
    }
};

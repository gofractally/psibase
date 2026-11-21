import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import { liveApi } from "./api";
import { demoApi } from "./demo";
import type { Contact, Line, Quote, Snapshot } from "./types";
import {
    decimal,
    display,
    paymentLink,
    percent,
    positive,
    ppm,
    readPaymentLink,
    readUnits,
    symbol as validSymbol,
    units,
} from "./money.mjs";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./style.css";

const demo = new URLSearchParams(location.search).get("demo") === "1";
const api = demo ? demoApi() : liveApi;
const empty: Snapshot = {
    lines: [],
    activity: { nodes: [], endCursor: null, hasNextPage: false },
    requests: [],
    settings: { requestOnly: false, routingReady: false, serverTime: "0" },
};
function pendingPayment() {
    const link = readPaymentLink(location.hash);
    if (link) return link;
    try {
        return JSON.parse(sessionStorage.getItem("favor-pending-payment") || "null") as ReturnType<
            typeof readPaymentLink
        >;
    } catch {
        return null;
    }
}
const initialPayment = pendingPayment();
const contactsUrl = new URL(location.href);
contactsUrl.hostname = ["homepage", ...location.hostname.split(".").slice(1)].join(".");
contactsUrl.pathname = "/contacts";
contactsUrl.search = "";
contactsUrl.hash = "";
const iconPaths: Record<string, React.ReactNode> = {
    home: (
        <>
            <rect x="3" y="3" width="7" height="7" rx="2" />
            <rect x="14" y="3" width="7" height="7" rx="2" />
            <rect x="3" y="14" width="7" height="7" rx="2" />
            <rect x="14" y="14" width="7" height="7" rx="2" />
        </>
    ),
    people: (
        <>
            <circle cx="9" cy="8" r="3" />
            <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-3-5" />
        </>
    ),
    activity: (
        <>
            <path d="M3 12h4l3-8 4 16 3-8h4" />
        </>
    ),
    request: (
        <>
            <rect x="5" y="3" width="14" height="18" rx="2" />
            <path d="M9 8h6M9 12h6M9 16h3" />
        </>
    ),
    settings: (
        <>
            <circle cx="12" cy="12" r="4" />
            <path d="m10 2 4 0 1 3 3 1 3 2-1 4 1 4-3 2-3 1-1 3h-4l-1-3-3-1-3-2 1-4-1-4 3-2 3-1z" />
        </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    send: (
        <>
            <path d="m4 4 17 8-17 8 3-8zM7 12h14" />
        </>
    ),
    receive: (
        <>
            <path d="M4 15v5h16v-5M12 3v12m-5-5 5 5 5-5" />
        </>
    ),
    lock: (
        <>
            <rect x="5" y="10" width="14" height="11" rx="3" />
            <path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" />
        </>
    ),
    search: (
        <>
            <circle cx="10" cy="10" r="6" />
            <path d="m15 15 6 6" />
        </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    refresh: (
        <>
            <path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2" />
        </>
    ),
    copy: (
        <>
            <rect x="8" y="8" width="12" height="13" rx="2" />
            <path d="M16 8V3H3v13h5" />
        </>
    ),
    link: (
        <>
            <path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3m-3 3-3 3a5 5 0 0 1-7-7l3-3m1 6 8-8" />
        </>
    ),
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {iconPaths[name] || iconPaths.people}
        </svg>
    );
}
function Avatar({
    account,
    name,
    small = false,
}: {
    account: string;
    name?: string;
    small?: boolean;
}) {
    const colors = ["mint", "lavender", "peach", "blue"];
    const index = Array.from(account).reduce((n, c) => n + c.charCodeAt(0), 0) % colors.length;
    return (
        <span aria-hidden="true" className={`avatar ${colors[index]} ${small ? "small" : ""}`}>
            {(name || account)
                .split(/[ -]/)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase()}
        </span>
    );
}
function Modal({
    title,
    children,
    close,
    busy = false,
}: {
    title: string;
    children: React.ReactNode;
    close: () => void;
    busy?: boolean;
}) {
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const el = root.current!;
        el.querySelector<HTMLElement>("input,button")?.focus();
        const handle = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !busy) close();
            if (event.key === "Tab") {
                const items = [
                    ...el.querySelectorAll<HTMLElement>(
                        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
                    ),
                ];
                const first = items[0],
                    last = items[items.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
        };
        document.addEventListener("keydown", handle);
        const original = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", handle);
            document.body.style.overflow = original;
            previous?.focus();
        };
    }, [busy]);
    return (
        <div
            className="overlay"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !busy) close();
            }}
        >
            <div
                className="modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
                ref={root}
            >
                <header>
                    <h2 id="modal-title">{title}</h2>
                    <button
                        className="icon-button"
                        aria-label="Close dialog"
                        disabled={busy}
                        onClick={close}
                    >
                        <Icon name="close" />
                    </button>
                </header>
                {children}
            </div>
        </div>
    );
}
const errorMessage = (error: unknown) => {
    const detail = error as { pluginId?: { service: string; plugin: string }; message?: string };
    return detail?.pluginId
        ? `${detail.message} (${detail.pluginId.service}/${detail.pluginId.plugin})`
        : error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "The request could not be completed. Please try again.";
};
const readableDate = (seconds: string) =>
    new Date(Number(seconds) * 1000).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
    });
const hex = (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function App() {
    const [user, setUser] = useState<string | null>(null),
        [data, setData] = useState(empty),
        [loading, setLoading] = useState(true),
        [busy, setBusy] = useState(false);
    const [error, setError] = useState(""),
        [notice, setNotice] = useState(""),
        [tab, setTab] = useState("overview"),
        [symbol, setSymbol] = useState(initialPayment?.symbol || "USD");
    const [contacts, setContacts] = useState<Contact[]>([]),
        [contactsLoaded, setContactsLoaded] = useState(false),
        [search, setSearch] = useState("");
    const [modal, setModal] = useState<"pay" | "person" | "settle" | null>(
            initialPayment ? "pay" : null,
        ),
        [formError, setFormError] = useState("");
    const [payee, setPayee] = useState(initialPayment?.to || ""),
        [amount, setAmount] = useState(initialPayment?.amount || ""),
        [memo, setMemo] = useState(initialPayment?.note || ""),
        [request, setRequest] = useState(initialPayment?.request || "");
    const [quote, setQuote] = useState<Quote | null>(null),
        [clock, setClock] = useState(Date.now());
    const [peer, setPeer] = useState(""),
        [nickname, setNickname] = useState(""),
        [limit, setLimit] = useState("100"),
        [fee, setFee] = useState("0"),
        [forward, setForward] = useState(true),
        [saveContact, setSaveContact] = useState(true),
        [extend, setExtend] = useState(true),
        [editing, setEditing] = useState(false);
    const [repayment, setRepayment] = useState(""),
        [acknowledged, setAcknowledged] = useState(false);
    const [requestAmount, setRequestAmount] = useState(""),
        [requestPayer, setRequestPayer] = useState(""),
        [requestHours, setRequestHours] = useState("24"),
        [requestLink, setRequestLink] = useState(""),
        [qr, setQr] = useState("");
    const generation = useRef(0),
        quoteGeneration = useRef(0),
        currentUser = useRef<string | null>(null),
        operation = useRef(false);
    const symbols = [...new Set(["USD", "BTC", symbol, ...data.lines.map((l) => l.symbol)])];
    const rows = data.lines.filter((l) => l.symbol === symbol);
    const name = (account: string) =>
        contacts.find((c) => c.account === account)?.nickname || account;
    const total = (field: "theyOwe" | "youOwe" | "canPay") =>
        decimal(rows.reduce((sum, l) => sum + readUnits(l[field]), 0n));
    const people = [
        ...new Set([...rows.map((l) => l.peer), ...contacts.map((c) => c.account)]),
    ].filter((p) => p !== user && (p + " " + name(p)).toLowerCase().includes(search.toLowerCase()));
    const linkExpiry = quote ? Number(quote.expiresAt) * 1000 : 0;
    const serverOffset =
        data.settings.serverTime === "0"
            ? 0
            : Number(data.settings.serverTime) * 1000 - clockAtLoad.current;

    async function refresh(showLoading = true) {
        const id = ++generation.current;
        if (showLoading) setLoading(true);
        try {
            const next = await api.user();
            if (id !== generation.current) return;
            if (next !== currentUser.current) {
                currentUser.current = next;
                setContacts([]);
                setContactsLoaded(false);
                setData(empty);
                setQuote(null);
                setRequestLink("");
            }
            setUser(next);
            if (next) {
                const snapshot = await api.snapshot();
                if (id !== generation.current) return;
                clockAtLoad.current = Date.now();
                setClock(Date.now());
                setData(snapshot);
            }
        } catch (e) {
            if (id === generation.current) setError(errorMessage(e));
        } finally {
            if (id === generation.current) setLoading(false);
        }
    }
    useEffect(() => {
        void refresh();
        const focus = () => {
            if (!operation.current) void refresh(false);
        };
        window.addEventListener("focus", focus);
        const timer = window.setInterval(() => setClock(Date.now()), 1000);
        return () => {
            generation.current++;
            window.removeEventListener("focus", focus);
            clearInterval(timer);
        };
    }, []);
    useEffect(() => {
        if (modal === "pay")
            sessionStorage.setItem(
                "favor-pending-payment",
                JSON.stringify({ to: payee, symbol, amount, request, note: memo }),
            );
        else sessionStorage.removeItem("favor-pending-payment");
    }, [modal, payee, symbol, amount, request, memo]);
    useEffect(() => {
        if (!notice) return;
        const id = setTimeout(() => setNotice(""), 6500);
        return () => clearTimeout(id);
    }, [notice]);
    useEffect(() => {
        let active = true;
        setQr("");
        if (requestLink)
            void QRCode.toDataURL(requestLink, {
                width: 228,
                margin: 2,
                color: { dark: "#143b32", light: "#ffffff" },
            }).then((result) => {
                if (active) setQr(result);
            });
        return () => {
            active = false;
        };
    }, [requestLink]);
    useEffect(() => {
        const update = () => {
            const p = readPaymentLink(location.hash);
            if (p) {
                setPayee(p.to);
                setSymbol(p.symbol);
                setAmount(p.amount);
                setRequest(p.request);
                setMemo(p.note);
                setQuote(null);
                setModal("pay");
            }
        };
        window.addEventListener("hashchange", update);
        return () => window.removeEventListener("hashchange", update);
    }, []);

    async function run(
        action: () => Promise<void>,
        message?: string,
        close = false,
        reload = true,
    ) {
        if (operation.current) return;
        operation.current = true;
        setBusy(true);
        setFormError("");
        setError("");
        try {
            await action();
            if (message) setNotice(message);
            if (close) setModal(null);
            if (reload) await refresh(false);
        } catch (e) {
            (modal ? setFormError : setError)(errorMessage(e));
        } finally {
            operation.current = false;
            setBusy(false);
        }
    }
    function openPay(to = "") {
        quoteGeneration.current++;
        setQuote(null);
        setPayee(to);
        setAmount("");
        setMemo("");
        setRequest("");
        setFormError("");
        setModal("pay");
    }
    function openPerson(account = "") {
        const line = rows.find((l) => l.peer === account);
        setPeer(account);
        setNickname(contacts.find((c) => c.account === account)?.nickname || "");
        setLimit(line?.youExtend || "100");
        setFee(percent(line?.yourFeePpm || 0));
        setForward(line?.forwarding ?? true);
        setExtend(true);
        setEditing(!!line);
        setSaveContact(!contacts.some((c) => c.account === account));
        setFormError("");
        setModal("person");
    }
    function editPayment() {
        quoteGeneration.current++;
        setQuote(null);
        setFormError("");
    }
    async function preview(event: React.FormEvent) {
        event.preventDefault();
        if (operation.current) return;
        if (!user) {
            await run(() => api.connect());
            return;
        }
        if (quote) {
            if (clock + serverOffset >= linkExpiry) {
                setQuote(null);
                setFormError("This preview expired. Review a fresh payment.");
                return;
            }
            await run(
                async () => {
                    await api.pay(quote, memo);
                    setQuote(null);
                    setAmount("");
                    setRequest("");
                    sessionStorage.removeItem("favor-pending-payment");
                    history.replaceState(null, "", location.pathname + location.search);
                },
                `Payment sent to ${name(quote.payee)}.`,
                true,
            );
            return;
        }
        const id = ++quoteGeneration.current;
        await run(async () => {
            positive(amount);
            validSymbol(symbol);
            if (!payee || payee === user) throw new Error("Choose someone other than yourself.");
            const result = await api.quote(payee, symbol, amount, crypto.randomUUID(), request);
            if (id === quoteGeneration.current) setQuote(result);
        });
    }
    async function importContacts() {
        await run(async () => {
            const result = await api.contacts();
            setContacts(result);
            setContactsLoaded(true);
        }, "Your Contacts are ready.");
    }
    async function createRequest(event: React.FormEvent) {
        event.preventDefault();
        await run(async () => {
            validSymbol(symbol);
            if (requestAmount) positive(requestAmount);
            const secret = crypto.getRandomValues(new Uint8Array(32));
            const hash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", secret)));
            const expiry = String(
                Math.floor((Date.now() + serverOffset) / 1000) + Number(requestHours) * 3600,
            );
            await api.createRequest(
                hash,
                symbol,
                requestAmount || "0",
                expiry,
                requestPayer || null,
            );
            setRequestLink(
                paymentLink(location.origin + (demo ? "?demo=1" : ""), {
                    to: user!,
                    symbol,
                    ...(requestAmount ? { amount: requestAmount } : {}),
                    request: hex(secret),
                }),
            );
        }, "Payment request created. Copy the link to share it.");
    }
    async function copyLink() {
        try {
            await navigator.clipboard.writeText(requestLink);
            setNotice("Payment link copied.");
        } catch {
            setError("Copy the link from the field below.");
        }
    }
    const closeModal = () => {
        sessionStorage.removeItem("favor-pending-payment");
        quoteGeneration.current++;
        setModal(null);
        setQuote(null);
        setFormError("");
    };
    const activity = data.activity.nodes.filter((a) => a.symbol === symbol);
    const personPicker = (
        <datalist id="people-options">
            {[...new Set([...contacts.map((c) => c.account), ...data.lines.map((l) => l.peer)])]
                .filter((p) => p !== user)
                .map((p) => (
                    <option key={p} value={p}>
                        {name(p)}
                    </option>
                ))}
        </datalist>
    );

    return (
        <div className="app">
            <aside className="sidebar">
                <a
                    className="brand"
                    href="#"
                    onClick={(e) => {
                        e.preventDefault();
                        setTab("overview");
                    }}
                >
                    <svg className="brand-mark" viewBox="0 0 36 36" fill="none" aria-hidden="true">
                        <path
                            d="M9 27V10a4 4 0 0 1 4-4h14M9 17h13"
                            stroke="currentColor"
                            strokeWidth="5"
                            strokeLinecap="round"
                        />
                        <circle cx="26" cy="27" r="4" fill="currentColor" />
                    </svg>
                    favor<span className="brand-dot">.</span>
                </a>
                <div className="sidebar-caption">PEOPLE MAKE IT POSSIBLE</div>
                <nav aria-label="Main navigation">
                    {[
                        ["overview", "home", "Overview"],
                        ["people", "people", "People"],
                        ["activity", "activity", "Activity"],
                        ["requests", "request", "Receive"],
                        ["settings", "settings", "Settings"],
                    ].map(([id, icon, label]) => (
                        <button
                            key={id}
                            className={tab === id ? "nav-item selected" : "nav-item"}
                            aria-current={tab === id ? "page" : undefined}
                            onClick={() => {
                                setTab(id);
                                setError("");
                            }}
                        >
                            <Icon name={icon} />
                            {label}
                        </button>
                    ))}
                </nav>
                <div className="sidebar-bottom">
                    <div className="privacy-note">
                        <Icon name="lock" />
                        <div>
                            <strong>Your circle stays yours</strong>
                            <p>
                                See your relationships.
                                <br />
                                Keep the wider network private.
                            </p>
                        </div>
                    </div>
                    <button
                        className="account"
                        disabled={busy}
                        onClick={() =>
                            user
                                ? void run(async () => {
                                      await api.logout();
                                      sessionStorage.removeItem("favor-pending-payment");
                                      setData(empty);
                                      setModal(null);
                                  }, "Signed out.")
                                : void run(() => api.connect())
                        }
                    >
                        <Avatar account={user || "guest"} small />
                        <span>
                            <strong>{user ? `@${user}` : "Connect an account"}</strong>
                            <small>{user ? "Click to sign out" : "Your psibase account"}</small>
                        </span>
                        <span className="account-dots">···</span>
                    </button>
                </div>
            </aside>
            <main>
                <div className="topbar">
                    <span>
                        <span className="breadcrumb">Your network</span>
                        <span className="breadcrumb-divider">/</span>
                        {tab === "requests" ? "Receive" : tab[0].toUpperCase() + tab.slice(1)}
                    </span>
                    <div className="topbar-actions">
                        {demo && <span className="demo-pill">DEMO · SAMPLE DATA</span>}
                        <span className="private-label">
                            <Icon name="lock" size={14} /> Private to you
                        </span>
                        <button
                            aria-label="Refresh account"
                            className="icon-button"
                            disabled={busy || loading}
                            onClick={() => void refresh()}
                        >
                            <Icon name="refresh" size={17} />
                        </button>
                    </div>
                </div>
                <div className="content">
                    {demo && (
                        <div className="demo-banner">
                            Explore with sample credit relationships. Changes stay in this browser;
                            no real payments are sent.
                        </div>
                    )}
                    {error && (
                        <div className="alert error" role="alert">
                            {error}
                            <button aria-label="Dismiss error" onClick={() => setError("")}>
                                ×
                            </button>
                        </div>
                    )}
                    {notice && (
                        <div className="toast" role="status">
                            <Icon name="check" />
                            {notice}
                        </div>
                    )}
                    {!user ? (
                        <section className="welcome card">
                            <span className="eyebrow">A LITTLE TRUST GOES A LONG WAY</span>
                            <h1>
                                Payments start
                                <br />
                                with people.
                            </h1>
                            <p>
                                Extend credit to people you know. Pay through your shared web of
                                trust, even when the recipient is outside your circle.
                            </p>
                            <button
                                className="primary"
                                disabled={busy || loading}
                                onClick={() => void run(() => api.connect())}
                            >
                                {loading ? "Connecting…" : "Connect your psibase account"}
                            </button>
                            <p className="fine-print">
                                Your Contacts, credit limits, and account permissions stay under
                                your control.
                            </p>
                        </section>
                    ) : (
                        <>
                            <header className="page-heading">
                                <div>
                                    <span className="eyebrow">
                                        {tab === "overview"
                                            ? "BUILT ON THE PEOPLE YOU KNOW"
                                            : "YOUR PERSONAL WEB OF TRUST"}
                                    </span>
                                    <h1>
                                        {tab === "overview"
                                            ? `Good to see you, ${user}.`
                                            : tab === "people"
                                              ? "People, not account numbers."
                                              : tab === "activity"
                                                ? "Every favor, accounted for."
                                                : tab === "requests"
                                                  ? "Make it easy to pay you."
                                                  : "Your trust. Your terms."}
                                    </h1>
                                    <p>
                                        {tab === "overview"
                                            ? "A little trust. A lot of possibility."
                                            : tab === "people"
                                              ? "Manage the credit you share with your circle."
                                              : tab === "activity"
                                                ? "Payments, repayments, and the fees you earn by helping."
                                                : tab === "requests"
                                                  ? "Share a one-use payment request with someone you know."
                                                  : "Choose how you receive payments and connect with people."}
                                    </p>
                                </div>
                                <div className="heading-actions">
                                    <label className="symbol-picker">
                                        <span className="sr-only">Currency symbol</span>
                                        <select
                                            disabled={busy || !!modal}
                                            value={symbol}
                                            onChange={(e) => {
                                                setSymbol(e.target.value);
                                                setQuote(null);
                                            }}
                                        >
                                            {symbols.map((s) => (
                                                <option key={s}>{s}</option>
                                            ))}
                                        </select>
                                    </label>
                                    {tab === "people" ? (
                                        <button
                                            className="primary"
                                            disabled={busy}
                                            onClick={() => openPerson()}
                                        >
                                            <Icon name="plus" /> Add person
                                        </button>
                                    ) : (
                                        <button
                                            className="primary"
                                            disabled={busy || !data.settings.routingReady}
                                            onClick={() => openPay()}
                                        >
                                            <Icon name="send" /> Pay someone
                                        </button>
                                    )}
                                </div>
                            </header>
                            {loading && (
                                <div className="loading" role="status">
                                    Loading your private network…
                                </div>
                            )}
                            {!loading && !data.settings.routingReady && (
                                <div className="alert">
                                    Payments are not available yet. The network operator needs to
                                    finish setting up Favor.
                                </div>
                            )}
                            {tab === "overview" && (
                                <>
                                    <div className="stats">
                                        <div className="stat card">
                                            <div className="stat-label">
                                                People owe you{" "}
                                                <span className="stat-symbol">{symbol}</span>
                                            </div>
                                            <div className="stat-value">
                                                {display(total("theyOwe"))}
                                            </div>
                                            <p>Credit held with your circle</p>
                                        </div>
                                        <div className="stat card">
                                            <div className="stat-label">
                                                You owe people{" "}
                                                <span className="stat-symbol">{symbol}</span>
                                            </div>
                                            <div className="stat-value">
                                                {display(total("youOwe"))}
                                            </div>
                                            <p>Balances you can pay back</p>
                                        </div>
                                        <div className="stat card stat-green">
                                            <div className="stat-label">
                                                Direct payment capacity{" "}
                                                <span className="stat-symbol">{symbol}</span>
                                            </div>
                                            <div className="stat-value">
                                                {display(total("canPay"))}
                                            </div>
                                            <p>Available across your relationships</p>
                                        </div>
                                    </div>
                                    <div className="overview-grid">
                                        <section className="card circle-card">
                                            <div className="section-header">
                                                <div>
                                                    <h2>Your circle</h2>
                                                    <p>Real people. Direct relationships.</p>
                                                </div>
                                                <button
                                                    className="text-button"
                                                    onClick={() => setTab("people")}
                                                >
                                                    View people
                                                </button>
                                            </div>
                                            <div
                                                className="circle-visual"
                                                aria-label={`You have ${rows.length} direct relationships in ${symbol}`}
                                            >
                                                <svg viewBox="0 0 480 230" aria-hidden="true">
                                                    {[
                                                        "M240 115 94 62",
                                                        "M240 115 387 66",
                                                        "M240 115 106 190",
                                                        "M240 115 375 187",
                                                    ]
                                                        .slice(0, rows.length)
                                                        .map((d) => (
                                                            <path
                                                                key={d}
                                                                d={d}
                                                                stroke="#d5e0da"
                                                                strokeWidth="1.5"
                                                                strokeDasharray="5 6"
                                                            />
                                                        ))}
                                                    <circle
                                                        cx="240"
                                                        cy="115"
                                                        r="64"
                                                        fill="none"
                                                        stroke="#e3eae5"
                                                    />
                                                    <circle
                                                        cx="240"
                                                        cy="115"
                                                        r="94"
                                                        fill="none"
                                                        stroke="#edf1ee"
                                                    />
                                                </svg>
                                                <div className="circle-self">
                                                    <Avatar account={user} />
                                                    <strong>You</strong>
                                                </div>
                                                {rows.slice(0, 4).map((l, i) => (
                                                    <button
                                                        key={l.peer}
                                                        className={`circle-person position-${i}`}
                                                        onClick={() => openPerson(l.peer)}
                                                    >
                                                        <Avatar
                                                            account={l.peer}
                                                            name={name(l.peer)}
                                                        />
                                                        <span>{name(l.peer).split(" ")[0]}</span>
                                                    </button>
                                                ))}
                                                {!rows.length && (
                                                    <div className="circle-empty">
                                                        Your first relationship starts here.
                                                    </div>
                                                )}
                                            </div>
                                            <div className="circle-footer">
                                                <span>
                                                    <Icon name="lock" size={15} /> Only your direct
                                                    connections are shown
                                                </span>
                                                <button
                                                    className="text-button"
                                                    onClick={() => openPerson()}
                                                >
                                                    <Icon name="plus" size={16} /> Add someone
                                                </button>
                                            </div>
                                        </section>
                                        <section className="possibility-card">
                                            <div className="small-network" aria-hidden="true">
                                                <span />
                                                <span />
                                                <span />
                                                <i />
                                                <i />
                                            </div>
                                            <span className="eyebrow">TRUST TRAVELS</span>
                                            <h2>
                                                Your circle opens
                                                <br />
                                                new possibilities.
                                            </h2>
                                            <p>
                                                Pay someone through the people you trust. Favor
                                                finds a low-fee path without showing you anyone
                                                else’s relationships.
                                            </p>
                                            <button
                                                className="light-button"
                                                disabled={busy || !data.settings.routingReady}
                                                onClick={() => openPay()}
                                            >
                                                Make a payment
                                            </button>
                                            <span className="possibility-footnote">
                                                Up to 7 hops · Review every payment
                                            </span>
                                        </section>
                                    </div>
                                    <section className="card">
                                        <div className="section-header">
                                            <div>
                                                <h2>Recent activity</h2>
                                                <p>
                                                    Your latest payments and repayments in {symbol}.
                                                </p>
                                            </div>
                                            <button
                                                className="text-button"
                                                onClick={() => setTab("activity")}
                                            >
                                                View all activity
                                            </button>
                                        </div>
                                        {renderActivity(activity.slice(0, 4))}
                                    </section>
                                </>
                            )}
                            {tab === "people" && (
                                <>
                                    <section className="contacts-callout">
                                        <span className="callout-icon">
                                            <Icon name="people" size={24} />
                                        </span>
                                        <div>
                                            <h3>
                                                {contactsLoaded
                                                    ? "Your Contacts are connected"
                                                    : "Your people are already in Contacts"}
                                            </h3>
                                            <p>
                                                {contactsLoaded
                                                    ? "Nicknames come from your existing address book. Credit is always a separate choice."
                                                    : "Bring in familiar names from your psibase address book, with your permission."}
                                            </p>
                                        </div>
                                        <button
                                            className="secondary"
                                            disabled={busy}
                                            onClick={() => void importContacts()}
                                        >
                                            {contactsLoaded
                                                ? "Refresh Contacts"
                                                : "Connect Contacts"}
                                        </button>
                                    </section>
                                    <div className="people-toolbar">
                                        <h2>
                                            Your people{" "}
                                            <span className="count">{people.length}</span>
                                        </h2>
                                        <label className="search">
                                            <Icon name="search" size={18} />
                                            <span className="sr-only">Search people</span>
                                            <input
                                                value={search}
                                                onChange={(e) => setSearch(e.target.value)}
                                                placeholder="Find a person or account"
                                            />
                                        </label>
                                    </div>
                                    <section className="card people-table">
                                        <div className="table-head">
                                            <span>Person</span>
                                            <span>Credit you extend</span>
                                            <span>Balance</span>
                                            <span />
                                        </div>
                                        {people.length ? (
                                            people.map((account) => {
                                                const l = rows.find((r) => r.peer === account);
                                                return (
                                                    <div className="person-row" key={account}>
                                                        <button
                                                            className="person-name"
                                                            onClick={() => openPerson(account)}
                                                        >
                                                            <Avatar
                                                                account={account}
                                                                name={name(account)}
                                                            />
                                                            <span>
                                                                <strong>{name(account)}</strong>
                                                                <small>@{account}</small>
                                                            </span>
                                                        </button>
                                                        <div className="person-limit">
                                                            <strong>
                                                                {display(l?.youExtend || "0")}
                                                            </strong>
                                                            <small>
                                                                {symbol}
                                                                {l
                                                                    ? ` · ${percent(l.yourFeePpm)}% routing fee`
                                                                    : " · No credit line yet"}
                                                            </small>
                                                        </div>
                                                        <div className="person-balance">
                                                            <strong>
                                                                {l && units(l.theyOwe) > 0n
                                                                    ? `${display(l.theyOwe)} owed to you`
                                                                    : l && units(l.youOwe) > 0n
                                                                      ? `You owe ${display(l.youOwe)}`
                                                                      : "All settled"}
                                                            </strong>
                                                            <small>
                                                                {l
                                                                    ? `They extend ${display(l.theyExtend)} ${symbol}`
                                                                    : "Contact only"}
                                                            </small>
                                                        </div>
                                                        <button
                                                            className="secondary compact"
                                                            disabled={busy}
                                                            onClick={() => openPay(account)}
                                                        >
                                                            Pay
                                                        </button>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="empty-state">
                                                <Icon name="people" size={32} />
                                                <h3>
                                                    {search
                                                        ? "No matching people"
                                                        : "Start with someone you trust"}
                                                </h3>
                                                <p>
                                                    {search
                                                        ? "Try a name or account."
                                                        : "Connect Contacts or add a person to extend your first line of credit."}
                                                </p>
                                                <button
                                                    className="secondary"
                                                    onClick={() => openPerson()}
                                                >
                                                    Add person
                                                </button>
                                            </div>
                                        )}
                                    </section>
                                    <p className="section-note">
                                        <Icon name="lock" size={15} /> A contact is a name in your
                                        address book. A credit line is your explicit agreement to
                                        accept that person’s debt.
                                    </p>
                                </>
                            )}
                            {tab === "activity" && (
                                <section className="card">
                                    <div className="section-header">
                                        <h2>Activity in {symbol}</h2>
                                        <span className="muted">Newest first</span>
                                    </div>
                                    {renderActivity(activity)}
                                    {data.activity.hasNextPage && (
                                        <div className="load-more">
                                            <button
                                                className="secondary"
                                                disabled={busy}
                                                onClick={() =>
                                                    void run(
                                                        async () => {
                                                            const page = await api.activity(
                                                                data.activity.endCursor!,
                                                            );
                                                            setData((d) => ({
                                                                ...d,
                                                                activity: {
                                                                    ...page,
                                                                    nodes: [
                                                                        ...d.activity.nodes,
                                                                        ...page.nodes,
                                                                    ],
                                                                },
                                                            }));
                                                        },
                                                        undefined,
                                                        false,
                                                        false,
                                                    )
                                                }
                                            >
                                                Load older activity
                                            </button>
                                        </div>
                                    )}
                                </section>
                            )}
                            {tab === "requests" && (
                                <div className="receive-grid">
                                    <section className="card request-form">
                                        <span className="eyebrow">
                                            A PERSONAL INVITATION TO PAY
                                        </span>
                                        <h2>Create a payment request</h2>
                                        <p>
                                            Each link can be paid once. It shares your account and
                                            payment details, never your credit relationships.
                                        </p>
                                        <form onSubmit={createRequest}>
                                            <fieldset disabled={busy}>
                                                <label>
                                                    Amount in {symbol}{" "}
                                                    <span className="optional">optional</span>
                                                    <input
                                                        inputMode="decimal"
                                                        value={requestAmount}
                                                        onChange={(e) =>
                                                            setRequestAmount(e.target.value)
                                                        }
                                                        placeholder="Payer chooses the amount"
                                                    />
                                                </label>
                                                <label>
                                                    Only this payer{" "}
                                                    <span className="optional">optional</span>
                                                    <input
                                                        list="people-options"
                                                        value={requestPayer}
                                                        onChange={(e) =>
                                                            setRequestPayer(e.target.value)
                                                        }
                                                        placeholder="Any person with the link"
                                                    />
                                                </label>
                                                <label>
                                                    Expires after
                                                    <select
                                                        value={requestHours}
                                                        onChange={(e) =>
                                                            setRequestHours(e.target.value)
                                                        }
                                                    >
                                                        <option value="1">1 hour</option>
                                                        <option value="24">24 hours</option>
                                                        <option value="168">7 days</option>
                                                    </select>
                                                </label>
                                                <button className="primary full" type="submit">
                                                    <Icon name="link" />{" "}
                                                    {busy ? "Creating…" : "Create payment link"}
                                                </button>
                                            </fieldset>
                                        </form>
                                    </section>
                                    <section className="card link-preview">
                                        {requestLink ? (
                                            <>
                                                <span className="success-icon">
                                                    <Icon name="check" size={25} />
                                                </span>
                                                <h2>Ready to share.</h2>
                                                <p>
                                                    Send this link to the person paying you.
                                                    <br />
                                                    Save it now; the secret is not stored on chain.
                                                </p>
                                                {qr && (
                                                    <img
                                                        src={qr}
                                                        width="228"
                                                        height="228"
                                                        alt="QR code for your one-use payment request"
                                                    />
                                                )}
                                                <label className="sr-only" htmlFor="payment-link">
                                                    Payment request link
                                                </label>
                                                <input
                                                    id="payment-link"
                                                    readOnly
                                                    value={requestLink}
                                                    onFocus={(e) => e.target.select()}
                                                />
                                                <button
                                                    className="primary"
                                                    onClick={() => void copyLink()}
                                                >
                                                    <Icon name="copy" /> Copy payment link
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <div className="receive-illustration">
                                                    <Icon name="receive" size={42} />
                                                </div>
                                                <h2>
                                                    A small link.
                                                    <br />A simpler payment.
                                                </h2>
                                                <p>
                                                    Your request will appear here, ready to copy or
                                                    scan.
                                                </p>
                                                <span className="badge">
                                                    <Icon name="lock" size={14} /> One use · You
                                                    control access
                                                </span>
                                            </>
                                        )}
                                    </section>
                                    <section className="card request-list">
                                        <div className="section-header">
                                            <h2>Your payment requests</h2>
                                            <span className="muted">
                                                Revocation takes effect on chain
                                            </span>
                                        </div>
                                        {data.requests.length ? (
                                            data.requests.map((r) => (
                                                <div className="request-row" key={r.hash}>
                                                    <div>
                                                        <strong>
                                                            {r.amount === "0"
                                                                ? "Any amount"
                                                                : display(r.amount)}{" "}
                                                            {r.symbol}
                                                        </strong>
                                                        <small>
                                                            {r.payer ? `For @${r.payer} · ` : ""}
                                                            Expires {readableDate(r.expiresAt)}
                                                        </small>
                                                    </div>
                                                    <span className="badge">
                                                        {r.revoked
                                                            ? "Revoked"
                                                            : r.consumed
                                                              ? "Paid"
                                                              : Number(r.expiresAt) * 1000 <=
                                                                  clock + serverOffset
                                                                ? "Expired"
                                                                : "Open"}
                                                    </span>
                                                    {!r.revoked && !r.consumed && (
                                                        <button
                                                            className="text-button"
                                                            disabled={busy}
                                                            onClick={() =>
                                                                void run(
                                                                    () => api.revokeRequest(r.hash),
                                                                    "Payment request revoked.",
                                                                )
                                                            }
                                                        >
                                                            Revoke
                                                        </button>
                                                    )}
                                                </div>
                                            ))
                                        ) : (
                                            <div className="empty-state">
                                                <p>No payment requests yet.</p>
                                            </div>
                                        )}
                                    </section>
                                </div>
                            )}
                            {tab === "settings" && (
                                <div className="settings-grid">
                                    <section className="card settings-card">
                                        <div className="setting-icon">
                                            <Icon name="lock" size={25} />
                                        </div>
                                        <h2>How people can pay you</h2>
                                        <p>
                                            Anyone still needs a valid path with enough credit.
                                            Request-only receiving also requires a one-use link that
                                            you create.
                                        </p>
                                        <label className="checkbox setting-toggle">
                                            <input
                                                type="checkbox"
                                                checked={data.settings.requestOnly}
                                                disabled={busy}
                                                onChange={(e) =>
                                                    void run(
                                                        () => api.setReceiving(e.target.checked),
                                                        "Receiving preference updated.",
                                                    )
                                                }
                                            />
                                            <span>
                                                <strong>Require a payment request</strong>
                                                <small>
                                                    Prevent quotes to your account without a valid
                                                    request link.
                                                </small>
                                            </span>
                                        </label>
                                        <button
                                            className="secondary"
                                            onClick={() => setTab("requests")}
                                        >
                                            Create a payment request
                                        </button>
                                    </section>
                                    <section className="card settings-card">
                                        <div className="setting-icon">
                                            <Icon name="people" size={25} />
                                        </div>
                                        <h2>One familiar address book</h2>
                                        <p>
                                            Favor uses the Profiles app’s Contacts. Nicknames,
                                            emails, and phone numbers stay in that local address
                                            book. They are never added to the credit ledger.
                                        </p>
                                        <button
                                            className="secondary"
                                            disabled={busy}
                                            onClick={() => void importContacts()}
                                        >
                                            {contactsLoaded
                                                ? "Refresh Contacts"
                                                : "Connect Contacts"}
                                        </button>
                                        <a
                                            className="text-button contacts-link"
                                            href={contactsUrl.toString()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            Open Contacts
                                        </a>
                                        <h3>Credit is always your choice</h3>
                                        <p>
                                            Adding a contact does not grant credit. Edit a person’s
                                            relationship to choose a symbol, limit, forwarding fee,
                                            and whether to help route payments.
                                        </p>
                                    </section>
                                    <section className="card settings-card wide">
                                        <h2>How Favor accounts for trust</h2>
                                        <div className="explainer-grid">
                                            <div>
                                                <h3>Each symbol stands on its own</h3>
                                                <p>
                                                    USD and BTC balances are separate. Favor records
                                                    personal obligations; it does not hold cash or
                                                    convert currencies.
                                                </p>
                                            </div>
                                            <div>
                                                <h3>Repay without starting over</h3>
                                                <p>
                                                    Opposite-direction payments reduce existing debt
                                                    first. When you receive repayment outside the
                                                    app, acknowledge it on the person’s
                                                    relationship.
                                                </p>
                                            </div>
                                            <div>
                                                <h3>Review, then pay</h3>
                                                <p>
                                                    Quotes last up to 60 seconds. If a line or fee
                                                    changes, refresh the quote. A failed payment
                                                    leaves every relationship unchanged.
                                                </p>
                                            </div>
                                        </div>
                                    </section>
                                </div>
                            )}
                        </>
                    )}
                    <footer className="page-footer">
                        <span>
                            favor<span> · </span>Built on psibase
                        </span>
                        <span>Trust stays personal.</span>
                    </footer>
                </div>
            </main>
            {personPicker}
            {modal === "pay" && (
                <Modal
                    title={quote ? "Review your payment" : "Pay someone"}
                    close={closeModal}
                    busy={busy}
                >
                    <form onSubmit={preview}>
                        <fieldset disabled={busy}>
                            <p className="modal-intro">
                                {quote
                                    ? "Your recipient gets the exact amount below. Your total includes every routing fee."
                                    : "Choose a person. Favor finds a path through your web of trust."}
                            </p>
                            <label>
                                To
                                <input
                                    list="people-options"
                                    required
                                    value={payee}
                                    onChange={(e) => {
                                        setPayee(e.target.value.trim().replace(/^@/, ""));
                                        editPayment();
                                    }}
                                    placeholder="Name or psibase account"
                                    autoComplete="off"
                                />
                                {payee && name(payee) !== payee && <small>{name(payee)}</small>}
                            </label>
                            <div className="form-columns">
                                <label>
                                    Amount
                                    <input
                                        required
                                        inputMode="decimal"
                                        value={amount}
                                        onChange={(e) => {
                                            setAmount(e.target.value);
                                            editPayment();
                                        }}
                                        placeholder="0.00"
                                    />
                                </label>
                                <label>
                                    Symbol
                                    <input
                                        required
                                        value={symbol}
                                        maxLength={12}
                                        onChange={(e) => {
                                            setSymbol(e.target.value.toUpperCase());
                                            editPayment();
                                        }}
                                    />
                                </label>
                            </div>
                            <label>
                                Note <span className="optional">optional</span>
                                <input
                                    value={memo}
                                    onChange={(e) => setMemo(e.target.value)}
                                    placeholder="What’s this for?"
                                    maxLength={128}
                                />
                            </label>
                            {request && (
                                <div className="inline-note">
                                    <Icon name="request" /> Payment request attached
                                </div>
                            )}
                            {quote && (
                                <div className="payment-review">
                                    <div>
                                        <span>{name(quote.payee)} receives</span>
                                        <strong>
                                            {display(quote.amount)} {quote.symbol}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>Routing fees</span>
                                        <span>
                                            {display(quote.fee)} {quote.symbol}
                                        </span>
                                    </div>
                                    <div className="review-total">
                                        <strong>Your total</strong>
                                        <strong>
                                            {display(quote.total)} {quote.symbol}
                                        </strong>
                                    </div>
                                    <small>
                                        {Math.max(
                                            0,
                                            Math.ceil((linkExpiry - clock - serverOffset) / 1000),
                                        )}{" "}
                                        seconds left to confirm · Route stays private
                                    </small>
                                </div>
                            )}
                            {formError && (
                                <div role="alert" className="alert error">
                                    {formError}
                                </div>
                            )}
                            <button
                                className="primary full"
                                type="submit"
                                disabled={busy || (!!quote && clock + serverOffset >= linkExpiry)}
                            >
                                {busy
                                    ? "Working…"
                                    : !user
                                      ? "Connect account to continue"
                                      : quote
                                        ? `Confirm payment · ${display(quote.total)} ${quote.symbol}`
                                        : "Review payment"}
                            </button>
                            {quote && (
                                <button
                                    type="button"
                                    className="text-button full"
                                    onClick={editPayment}
                                >
                                    Refresh or change payment
                                </button>
                            )}
                            <p className="fine-print">
                                You owe only your direct contacts along the route. No balances
                                change until you confirm.
                            </p>
                        </fieldset>
                    </form>
                </Modal>
            )}
            {modal === "person" && (
                <Modal
                    title={
                        editing ? `Your relationship with ${name(peer)}` : "Add someone you trust"
                    }
                    close={closeModal}
                    busy={busy}
                >
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void run(
                                async () => {
                                    if (!peer || peer === user)
                                        throw new Error("Choose someone other than yourself.");
                                    validSymbol(symbol);
                                    if (extend) units(limit);
                                    const feePpm = ppm(fee);
                                    if (saveContact && !contacts.some((c) => c.account === peer)) {
                                        await api.saveContact({
                                            account: peer,
                                            ...(nickname ? { nickname } : {}),
                                        });
                                        setContacts((c) => [
                                            ...c,
                                            { account: peer, nickname: nickname || undefined },
                                        ]);
                                        setSaveContact(false);
                                    }
                                    if (extend)
                                        await api.setLine(peer, symbol, limit, feePpm, forward);
                                    else if (!saveContact)
                                        throw new Error(
                                            "Choose to save the contact or extend credit.",
                                        );
                                },
                                editing ? "Credit relationship updated." : "Person added.",
                                true,
                            );
                        }}
                    >
                        <fieldset disabled={busy}>
                            <p className="modal-intro">
                                Keep a familiar name in Contacts, and choose how much credit you’re
                                comfortable extending.
                            </p>
                            <label>
                                Account
                                <input
                                    list="people-options"
                                    required
                                    value={peer}
                                    disabled={editing}
                                    onChange={(e) => {
                                        const account = e.target.value.trim().replace(/^@/, "");
                                        setPeer(account);
                                        const c = contacts.find((c) => c.account === account);
                                        setNickname(c?.nickname || "");
                                        setSaveContact(!c);
                                    }}
                                    placeholder="psibase account"
                                />
                            </label>
                            {!contacts.some((c) => c.account === peer) && (
                                <>
                                    <label>
                                        Nickname <span className="optional">optional</span>
                                        <input
                                            value={nickname}
                                            onChange={(e) => setNickname(e.target.value)}
                                            placeholder="A name you recognize"
                                        />
                                    </label>
                                    <label className="checkbox">
                                        <input
                                            type="checkbox"
                                            checked={saveContact}
                                            onChange={(e) => setSaveContact(e.target.checked)}
                                        />{" "}
                                        Save to my existing Contacts
                                    </label>
                                </>
                            )}
                            {!editing && (
                                <label className="checkbox">
                                    <input
                                        type="checkbox"
                                        checked={extend}
                                        onChange={(e) => setExtend(e.target.checked)}
                                    />{" "}
                                    Extend a line of credit
                                </label>
                            )}
                            {extend && (
                                <>
                                    <div className="form-columns">
                                        <label>
                                            Credit you extend
                                            <input
                                                required
                                                inputMode="decimal"
                                                value={limit}
                                                onChange={(e) => setLimit(e.target.value)}
                                            />
                                        </label>
                                        <label>
                                            Symbol
                                            <input
                                                required
                                                disabled={editing}
                                                value={symbol}
                                                onChange={(e) =>
                                                    setSymbol(e.target.value.toUpperCase())
                                                }
                                                maxLength={12}
                                            />
                                        </label>
                                    </div>
                                    <div className="explanation">
                                        <strong>
                                            You agree to accept up to {limit || "0"} {symbol} of @
                                            {peer || "this person"}’s debt.
                                        </strong>
                                        <p>
                                            This lets them pay you or route payments through you. It
                                            does not give you credit from them.
                                        </p>
                                    </div>
                                    <label>
                                        Your routing fee (%)
                                        <input
                                            required
                                            inputMode="decimal"
                                            value={fee}
                                            onChange={(e) => setFee(e.target.value)}
                                        />
                                        <small>
                                            Earned when you forward a payment to this person. Your
                                            own payments have no routing fee here.
                                        </small>
                                    </label>
                                    <label className="checkbox">
                                        <input
                                            type="checkbox"
                                            checked={forward}
                                            onChange={(e) => setForward(e.target.checked)}
                                        />{" "}
                                        Help forward payments through this relationship
                                    </label>
                                    {editing &&
                                        (() => {
                                            const l = rows.find((l) => l.peer === peer)!;
                                            return (
                                                <div className="relationship-summary">
                                                    <div>
                                                        <span>They extend to you</span>
                                                        <strong>
                                                            {display(l.theyExtend)} {symbol}
                                                        </strong>
                                                    </div>
                                                    <div>
                                                        <span>
                                                            {units(l.theyOwe) > 0n
                                                                ? "They owe you"
                                                                : "You owe them"}
                                                        </span>
                                                        <strong>
                                                            {display(
                                                                units(l.theyOwe) > 0n
                                                                    ? l.theyOwe
                                                                    : l.youOwe,
                                                            )}{" "}
                                                            {symbol}
                                                        </strong>
                                                    </div>
                                                    {units(l.theyOwe) > 0n && (
                                                        <button
                                                            type="button"
                                                            className="text-button"
                                                            onClick={() => {
                                                                setRepayment(l.theyOwe);
                                                                setAcknowledged(false);
                                                                setFormError("");
                                                                setModal("settle");
                                                            }}
                                                        >
                                                            Record repayment received
                                                        </button>
                                                    )}
                                                    <small>
                                                        Lowering a limit never erases an existing
                                                        balance. Set it to zero to stop extending
                                                        new credit.
                                                    </small>
                                                </div>
                                            );
                                        })()}
                                </>
                            )}
                            {formError && (
                                <div className="alert error" role="alert">
                                    {formError}
                                </div>
                            )}
                            <button type="submit" className="primary full">
                                {busy ? "Saving…" : editing ? "Save relationship" : "Add person"}
                            </button>
                        </fieldset>
                    </form>
                </Modal>
            )}
            {modal === "settle" && (
                <Modal title="Record repayment received" close={closeModal} busy={busy}>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            void run(
                                async () => {
                                    positive(repayment);
                                    if (!acknowledged)
                                        throw new Error("Confirm that you received the repayment.");
                                    await api.settle(peer, symbol, repayment, crypto.randomUUID());
                                },
                                "Repayment recorded. The balance has been reduced.",
                                true,
                            );
                        }}
                    >
                        <fieldset disabled={busy}>
                            <p className="modal-intro">
                                Use this after @{peer} pays you outside Favor, such as in cash. It
                                reduces what they owe you; it does not send money.
                            </p>
                            <label>
                                Amount received in {symbol}
                                <input
                                    required
                                    inputMode="decimal"
                                    value={repayment}
                                    onChange={(e) => setRepayment(e.target.value)}
                                />
                            </label>
                            <label className="checkbox">
                                <input
                                    type="checkbox"
                                    required
                                    checked={acknowledged}
                                    onChange={(e) => setAcknowledged(e.target.checked)}
                                />{" "}
                                I have received this repayment and want to reduce their debt.
                            </label>
                            {formError && (
                                <div className="alert error" role="alert">
                                    {formError}
                                </div>
                            )}
                            <button type="submit" className="primary full">
                                {busy ? "Recording…" : "Confirm repayment received"}
                            </button>
                        </fieldset>
                    </form>
                </Modal>
            )}
        </div>
    );
    function renderActivity(items: Snapshot["activity"]["nodes"]) {
        return items.length ? (
            <div className="activity-list">
                {items.map((a) => {
                    const outgoing = a.kind === "sent",
                        routed = a.kind === "routed",
                        repayment = a.kind.includes("repa");
                    const person = a.outgoing || a.incoming || "";
                    return (
                        <div className="activity-row" key={a.id}>
                            <span className={`activity-icon ${outgoing ? "" : "inbound"}`}>
                                <Icon
                                    name={
                                        routed
                                            ? "link"
                                            : repayment
                                              ? "check"
                                              : outgoing
                                                ? "send"
                                                : "receive"
                                    }
                                    size={19}
                                />
                            </span>
                            <div className="activity-description">
                                <strong>
                                    {routed
                                        ? "Helped route a payment"
                                        : a.kind === "repayment-recorded"
                                          ? `Recorded repayment from ${name(person)}`
                                          : a.kind === "repaid"
                                            ? `Repayment acknowledged by ${name(person)}`
                                            : `${outgoing ? "Paid" : "Received from"} ${name(person)}`}
                                </strong>
                                <small>
                                    {a.memo ||
                                        (routed
                                            ? `Between your direct contacts · ${display(a.earned)} ${a.symbol} earned`
                                            : repayment
                                              ? "Balance reduced · Received outside Favor"
                                              : "Through your web of trust")}
                                </small>
                            </div>
                            <div className="activity-value">
                                <strong>
                                    {routed
                                        ? "+" + display(a.earned)
                                        : repayment
                                          ? display(a.received)
                                          : (outgoing ? "−" : "+") +
                                            display(outgoing ? a.sent : a.received)}{" "}
                                    <span>{a.symbol}</span>
                                </strong>
                                <small>{readableDate(a.time)}</small>
                            </div>
                        </div>
                    );
                })}
            </div>
        ) : (
            <div className="empty-state">
                <Icon name="activity" size={30} />
                <h3>A fresh start</h3>
                <p>Your payments and repayments in {symbol} will appear here.</p>
            </div>
        );
    }
}
const clockAtLoad = { current: Date.now() };
createRoot(document.getElementById("root")!).render(<App />);

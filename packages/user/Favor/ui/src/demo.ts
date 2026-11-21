// Explicit browser-local demonstration only. Production uses the psibase API.
import type { Api, Activity, Contact, Line, PaymentRequest, Quote } from "./types";
import { units, decimal } from "./money.mjs";
type Pair = {
    a: string;
    b: string;
    symbol: string;
    al: string;
    bl: string;
    balance: string;
    af: number;
    bf: number;
    forward: boolean;
    rev: number;
};
type State = {
    pairs: Pair[];
    contacts: Contact[];
    activity: Activity[];
    requests: PaymentRequest[];
    only: boolean;
    used: string[];
    key: number[];
};
const fixture = (): State => ({
    pairs: [
        {
            a: "dan",
            b: "mike",
            symbol: "USD",
            al: "150",
            bl: "200",
            balance: "35",
            af: 2500,
            bf: 0,
            forward: true,
            rev: 1,
        },
        {
            a: "dan",
            b: "leah",
            symbol: "USD",
            al: "300",
            bl: "250",
            balance: "-42.5",
            af: 1000,
            bf: 0,
            forward: true,
            rev: 1,
        },
        {
            a: "dan",
            b: "nora",
            symbol: "USD",
            al: "100",
            bl: "100",
            balance: "0",
            af: 0,
            bf: 0,
            forward: true,
            rev: 1,
        },
        {
            a: "mike",
            b: "jon",
            symbol: "USD",
            al: "300",
            bl: "300",
            balance: "0",
            af: 1500,
            bf: 0,
            forward: true,
            rev: 1,
        },
        {
            a: "dan",
            b: "mike",
            symbol: "BTC",
            al: "0.01",
            bl: "0.02",
            balance: "0.001",
            af: 0,
            bf: 0,
            forward: true,
            rev: 1,
        },
    ],
    contacts: [
        { account: "mike", nickname: "Mike Manfredi" },
        { account: "leah", nickname: "Leah Chen" },
        { account: "nora", nickname: "Nora Wilson" },
        { account: "jon", nickname: "Jon Williamson" },
    ],
    activity: [
        {
            id: "3",
            kind: "sent",
            symbol: "USD",
            incoming: null,
            outgoing: "leah",
            received: "0",
            sent: "42.5",
            earned: "0",
            memo: "Dinner at the lake",
            time: String(Math.floor(Date.now() / 1000) - 3600),
        },
        {
            id: "2",
            kind: "received",
            symbol: "USD",
            incoming: "mike",
            outgoing: null,
            received: "35",
            sent: "0",
            earned: "0",
            memo: "Saturday market",
            time: String(Math.floor(Date.now() / 1000) - 86400),
        },
    ],
    requests: [],
    only: false,
    used: [],
    key: Array.from(crypto.getRandomValues(new Uint8Array(32))),
});
const STORE = "favor-demo-v1";
function load(): State {
    const saved = localStorage.getItem(STORE);
    if (saved) return JSON.parse(saved);
    const initial = fixture();
    save(initial);
    return initial;
}
function save(s: State) {
    localStorage.setItem(STORE, JSON.stringify(s));
}
function balance(s: string) {
    return s.startsWith("-") ? -units(s.slice(1)) : units(s);
}
function lines(s: State): Line[] {
    return s.pairs
        .filter((p) => p.a === "dan" || p.b === "dan")
        .map((p) => {
            const a = p.a === "dan",
                b = balance(p.balance) * (a ? 1n : -1n);
            const max = (n: bigint) => (n > 0n ? n : 0n);
            return {
                peer: a ? p.b : p.a,
                symbol: p.symbol,
                youExtend: a ? p.al : p.bl,
                theyExtend: a ? p.bl : p.al,
                theyOwe: decimal(max(b)),
                youOwe: decimal(max(-b)),
                canPay: decimal(max(units(a ? p.bl : p.al) + b)),
                canReceive: decimal(max(units(a ? p.al : p.bl) - b)),
                yourFeePpm: a ? p.af : p.bf,
                theirFeePpm: a ? p.bf : p.af,
                forwarding: p.forward,
                theirForwarding: p.forward,
                cursor: p.symbol + ":" + (a ? p.b : p.a),
            };
        });
}
function route(s: State, payee: string, symbol: string, amount: bigint) {
    type Step = { i: number; from: string; to: string; amount: string; rev: number };
    const queue: { at: string; required: bigint; seen: string[]; steps: Step[] }[] = [
        { at: payee, required: amount, seen: [payee], steps: [] },
    ];
    for (let work = 0; queue.length && work < 50000; work++) {
        queue.sort((a, b) => (a.required < b.required ? -1 : a.required > b.required ? 1 : 0));
        const item = queue.shift()!;
        if (item.at === "dan")
            return { total: decimal(item.required), steps: item.steps.reverse() };
        if (item.steps.length === 7) continue;
        s.pairs.forEach((p, i) => {
            if (p.symbol !== symbol || !(p.a === item.at || p.b === item.at)) return;
            const from = p.a === item.at ? p.b : p.a,
                a = from === p.a;
            if (item.seen.includes(from) || (from !== "dan" && !p.forward)) return;
            const cap = units(a ? p.bl : p.al) + (a ? balance(p.balance) : -balance(p.balance));
            if (cap < item.required) return;
            const fee =
                from === "dan"
                    ? 0n
                    : (item.required * BigInt(a ? p.af : p.bf) + 999999n) / 1000000n;
            queue.push({
                at: from,
                required: item.required + fee,
                seen: [...item.seen, from],
                steps: [
                    ...item.steps,
                    { i, from, to: item.at, amount: decimal(item.required), rev: p.rev },
                ],
            });
        });
    }
    throw new Error("Payment unavailable; request a fresh preview.");
}
async function key(s: State) {
    return crypto.subtle.importKey("raw", new Uint8Array(s.key), "AES-GCM", false, [
        "encrypt",
        "decrypt",
    ]);
}
async function seal(s: State, value: unknown) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await key(s),
        new TextEncoder().encode(JSON.stringify(value)),
    );
    return JSON.stringify({ iv: Array.from(iv), cipher: Array.from(new Uint8Array(cipher)) });
}
async function open(s: State, encoded: string) {
    const { iv, cipher } = JSON.parse(encoded);
    return JSON.parse(
        new TextDecoder().decode(
            await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: new Uint8Array(iv) },
                await key(s),
                new Uint8Array(cipher),
            ),
        ),
    );
}
function log(s: State, kind: string, symbol: string, peer: string, amount: string, memo = "") {
    s.activity.unshift({
        id: String(Date.now()),
        kind,
        symbol,
        incoming: kind === "sent" ? null : peer,
        outgoing: kind === "sent" ? peer : null,
        received: kind === "sent" ? "0" : amount,
        sent: kind === "sent" ? amount : "0",
        earned: "0",
        memo,
        time: String(Math.floor(Date.now() / 1000)),
    });
}
export function demoApi(): Api {
    let connected = true;
    return {
        async user() {
            return connected ? "dan" : null;
        },
        async connect() {
            connected = true;
        },
        async logout() {
            connected = false;
        },
        async snapshot() {
            const s = load();
            return {
                lines: lines(s),
                activity: { nodes: s.activity, endCursor: null, hasNextPage: false },
                requests: s.requests,
                settings: {
                    requestOnly: s.only,
                    routingReady: true,
                    serverTime: String(Math.floor(Date.now() / 1000)),
                },
            };
        },
        async contacts() {
            return load().contacts;
        },
        async saveContact(contact) {
            const s = load();
            if (s.contacts.some((c) => c.account === contact.account))
                throw new Error("Contact already exists.");
            s.contacts.push(contact);
            save(s);
        },
        async setLine(peer, symbol, limit, fee, forward) {
            if (peer === "dan" || !/^[a-z][a-z0-9-]{0,17}$/.test(peer))
                throw new Error("Enter another account name.");
            units(limit);
            const s = load();
            let p = s.pairs.find(
                (p) =>
                    p.symbol === symbol &&
                    ((p.a === "dan" && p.b === peer) || (p.b === "dan" && p.a === peer)),
            );
            if (!p) {
                p = {
                    a: "dan",
                    b: peer,
                    symbol,
                    al: "0",
                    bl: "0",
                    balance: "0",
                    af: 0,
                    bf: 0,
                    forward: true,
                    rev: 0,
                };
                s.pairs.push(p);
            }
            if (p.a === "dan") {
                p.al = limit;
                p.af = fee;
            } else {
                p.bl = limit;
                p.bf = fee;
            }
            p.forward = forward;
            p.rev++;
            save(s);
        },
        async quote(peer, symbol, amount, reference, request) {
            const s = load();
            if (units(amount) === 0n || peer === "dan")
                throw new Error("Choose a recipient and positive amount.");
            if (request)
                throw new Error(
                    "Demo requests cannot be paid from the same demo account. Use a connected psibase network to try another payer.",
                );
            const found = route(s, peer, symbol, units(amount));
            const expiresAt = String(Math.floor(Date.now() / 1000) + 60);
            const summary = {
                payee: peer,
                symbol,
                amount,
                total: found.total,
                reference,
                expiresAt,
            };
            return {
                ...summary,
                fee: decimal(units(found.total) - units(amount)),
                encodedRoute: await seal(s, { ...summary, steps: found.steps }),
            };
        },
        async pay(quote: Quote, memo) {
            const s = load(),
                decoded = await open(s, quote.encodedRoute);
            if (
                decoded.reference !== quote.reference ||
                decoded.total !== quote.total ||
                decoded.payee !== quote.payee ||
                Number(decoded.expiresAt) < Date.now() / 1000 ||
                s.used.includes(quote.reference)
            )
                throw new Error("Payment unavailable; request a fresh preview.");
            for (const step of decoded.steps) {
                const p = s.pairs[step.i];
                if (p.rev !== step.rev) throw new Error("Credit changed. Review a fresh preview.");
                const a = p.a === step.from;
                const cap = units(a ? p.bl : p.al) + (a ? balance(p.balance) : -balance(p.balance));
                if (cap < units(step.amount))
                    throw new Error("Credit changed. Review a fresh preview.");
            }
            for (const step of decoded.steps) {
                const p = s.pairs[step.i];
                p.balance = decimal(
                    balance(p.balance) + (p.a === step.from ? -1n : 1n) * units(step.amount),
                );
            }
            s.used.push(quote.reference);
            log(s, "sent", quote.symbol, quote.payee, quote.total, memo);
            save(s);
        },
        async settle(peer, symbol, amount, reference) {
            const s = load();
            if (s.used.includes(reference)) throw new Error("Repayment already recorded.");
            const row = lines(s).find((l) => l.peer === peer && l.symbol === symbol);
            if (!row || units(amount) === 0n || units(amount) > units(row.theyOwe))
                throw new Error("Repayment exceeds what this person owes you.");
            const p = s.pairs.find((p) => p.symbol === symbol && (p.a === peer || p.b === peer))!;
            p.balance = decimal(balance(p.balance) + (p.a === "dan" ? -1n : 1n) * units(amount));
            s.used.push(reference);
            log(s, "repayment-recorded", symbol, peer, amount);
            save(s);
        },
        async setReceiving(only) {
            const s = load();
            s.only = only;
            save(s);
        },
        async createRequest(hash, symbol, amount, expiresAt, payer) {
            const s = load();
            s.requests.unshift({
                hash,
                symbol,
                amount,
                expiresAt,
                payer,
                consumed: false,
                revoked: false,
            });
            save(s);
        },
        async revokeRequest(hash) {
            const s = load();
            const r = s.requests.find((r) => r.hash === hash);
            if (r) r.revoked = true;
            save(s);
        },
        async activity() {
            return { nodes: [], endCursor: null, hasNextPage: false };
        },
    };
}

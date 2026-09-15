import { displayAmount, humanToRaw } from "@/lib/amount";
import type { ActivityEvent } from "@/lib/graphql";

export type ActivityFilter =
    | "all"
    | "payments"
    | "claims"
    | "books"
    | "requests"
    | "lines";

const PAYMENT_KINDS = new Set([
    "path_draw",
    "path_pay",
    "deposit",
    "net",
    "forgive",
    "convert",
    "cash_out",
    "cash_in",
    "fulfill",
]);
const CLAIM_KINDS = new Set(["sell_claim", "buy_claim"]);
const BOOK_KINDS = new Set(["book", "book_auth", "rm_book_auth"]);
const REQUEST_KINDS = new Set([
    "invoice",
    "please_book",
    "fulfill",
    "req_cancel",
]);
const LINE_KINDS = new Set(["credit_line", "rm_credit_line"]);

export function activityMatches(
    kind: string,
    filter: ActivityFilter,
): boolean {
    if (filter === "all") return true;
    if (filter === "payments") return PAYMENT_KINDS.has(kind);
    if (filter === "claims") return CLAIM_KINDS.has(kind);
    if (filter === "books") return BOOK_KINDS.has(kind);
    if (filter === "requests") return REQUEST_KINDS.has(kind);
    return LINE_KINDS.has(kind);
}

export function kindLabel(kind: string): string {
    switch (kind) {
        case "path_draw":
            return "Path hop";
        case "path_pay":
            return "Payment";
        case "deposit":
            return "Deposit";
        case "net":
            return "Net";
        case "forgive":
            return "Write-off";
        case "convert":
            return "Convert";
        case "cash_out":
            return "Cash out";
        case "cash_in":
            return "Cash in";
        case "credit_line":
            return "Credit line";
        case "book":
            return "Booked";
        case "book_auth":
            return "Book-auth";
        case "rm_book_auth":
            return "Revoke book-auth";
        case "rm_credit_line":
            return "Remove line";
        case "buy_claim":
            return "Buy claim";
        case "sell_claim":
            return "Sell claim";
        case "invoice":
            return "Invoice";
        case "please_book":
            return "Deposit request";
        case "fulfill":
            return "Invoice paid";
        case "req_cancel":
            return "Cancel request";
        default:
            return kind;
    }
}

function namedAccount(s: string | undefined): string | undefined {
    const t = s?.trim();
    if (!t || t === "0") return undefined;
    return t;
}

function qty(amount: string, symbol: string): string {
    return `${displayAmount(amount)} ${symbol}`;
}

export function describeEvent(
    e: ActivityEvent,
    viewer: string,
    symbolOf: (id: number) => string,
    precisionOf: (id: number) => number,
    label: (account: string) => string = (a) => a,
): { title: string; detail: string } {
    const sym = symbolOf(e.assetId);
    const prec = precisionOf(e.assetId);
    const amt = displayAmount(e.amount);
    const netted = displayAmount(e.netted);
    const otherSym = symbolOf(e.otherAssetId);
    const nettedRaw = humanToRaw(e.netted || "0", prec);
    const you = e.actor === viewer;
    const nameOf = (account: string) =>
        namedAccount(account) ? label(account) : account;
    const other = nameOf(e.counterparty);
    const actor = nameOf(e.actor);
    const req =
        e.requestId && e.requestId > 0 ? `invoice #${e.requestId}` : "";
    const memo = e.memo?.trim();
    const debtor = namedAccount(e.kind === "sell_claim" || e.kind === "buy_claim" ? memo : undefined);

    switch (e.kind) {
        case "path_draw": {
            const title = you
                ? `You drew ${qty(e.amount, sym)} on ${other}`
                : `${actor} paid you ${qty(e.amount, sym)}`;
            const detail =
                nettedRaw > 0n
                    ? `Path hop · auto-netted ${qty(e.netted, sym)}`
                    : `Drew on the credit line · ${other}`;
            return { title, detail };
        }
        case "path_pay": {
            const same = e.otherAssetId === e.assetId;
            const gotSym = same ? sym : otherSym;
            const title = you
                ? `You paid ${other} ${qty(e.netted, gotSym)}`
                : `${actor} paid you ${qty(e.netted, gotSym)}`;
            const bits = [
                you ? `To ${other}` : `From ${actor}`,
                !same || amt !== netted ? `sent ${qty(e.amount, sym)}` : "",
                req,
            ].filter(Boolean);
            return { title, detail: bits.join(" · ") };
        }
        case "deposit": {
            const title = you
                ? `You booked a deposit of ${qty(e.amount, sym)}`
                : `${actor} booked a deposit of ${qty(e.amount, sym)}`;
            const detail =
                nettedRaw > 0n
                    ? `Auto-netted ${qty(e.netted, sym)} · ${other}`
                    : `Liability booked · ${other}`;
            return { title, detail };
        }
        case "net":
            return {
                title: `Netted ${qty(e.amount, sym)}`,
                detail: `Mutual claims cancelled · ${other}`,
            };
        case "forgive": {
            const title = you
                ? `You wrote off ${qty(e.amount, sym)}`
                : `${actor} wrote off ${qty(e.amount, sym)}`;
            return { title, detail: `Claim on ${other}` };
        }
        case "convert":
            return {
                title: `Converted ${qty(e.amount, sym)} → ${qty(e.netted, otherSym)}`,
                detail: `Rebook · ${other}`,
            };
        case "cash_out":
            return {
                title: you
                    ? `You cashed out ${qty(e.amount, sym)}`
                    : `${actor} cashed out ${qty(e.amount, sym)}`,
                detail: `Tokens from vault · ${other}`,
            };
        case "cash_in":
            return {
                title: you
                    ? `You cashed in ${qty(e.amount, sym)}`
                    : `${actor} cashed in ${qty(e.amount, sym)}`,
                detail: `Tokens into vault · ${other}`,
            };
        case "invoice": {
            const who =
                other === "0" || !other
                    ? "anyone"
                    : other;
            const title = you
                ? `You invoiced ${who} ${qty(e.amount, sym)}`
                : `${actor} invoiced you ${qty(e.amount, sym)}`;
            return {
                title,
                detail: [req, memo].filter(Boolean).join(" · ") || who,
            };
        }
        case "please_book": {
            const title = you
                ? `You asked ${other} to book ${qty(e.amount, sym)}`
                : `${actor} asked you to book ${qty(e.amount, sym)}`;
            return {
                title,
                detail: [req, memo].filter(Boolean).join(" · ") || other,
            };
        }
        case "fulfill": {
            const title = you
                ? `You paid ${other}'s ${req || "invoice"} · ${qty(e.amount, sym)}`
                : `${actor} paid your ${req || "invoice"} · ${qty(e.amount, sym)}`;
            return { title, detail: memo || other };
        }
        case "req_cancel": {
            const title = you
                ? `You cancelled ${req || "a request"} for ${qty(e.amount, sym)}`
                : `${actor} cancelled ${req || "a request"}`;
            return { title, detail: memo || other };
        }
        case "credit_line": {
            const title = you
                ? `You lined ${other} for ${qty(e.amount, sym)}`
                : `${actor} lined you for ${qty(e.amount, sym)}`;
            return { title, detail: `Credit line · ${other}` };
        }
        case "rm_credit_line": {
            const title = you
                ? `You removed your line to ${other}`
                : `${actor} removed their line to you`;
            return { title, detail: `Credit line erased` };
        }
        case "book": {
            const title = you
                ? `You booked ${qty(e.amount, sym)} onto ${other}`
                : `${actor} booked ${qty(e.amount, sym)} onto you`;
            const detail =
                nettedRaw > 0n
                    ? `Auto-netted ${qty(e.netted, sym)}`
                    : "Authorized expense";
            return {
                title,
                detail: memo ? `${detail} · ${memo}` : detail,
            };
        }
        case "book_auth": {
            const title = you
                ? `You allowed ${other} to book up to ${qty(e.amount, sym)}`
                : `${actor} allowed you to book up to ${qty(e.amount, sym)}`;
            return { title, detail: "Standing book-auth" };
        }
        case "rm_book_auth": {
            const title = you
                ? `You revoked book-auth for ${other}`
                : `${actor} revoked your book-auth`;
            return { title, detail: "Standing book-auth removed" };
        }
        case "sell_claim":
        case "buy_claim": {
            const on = debtor ? `${nameOf(debtor)}'s debt` : "a claim";
            const proceeds = qty(e.netted, sym);
            if (e.kind === "sell_claim") {
                const title = you
                    ? `You sold ${qty(e.amount, sym)} of ${on} to ${other}`
                    : `${actor} sold you ${qty(e.amount, sym)} of ${on}`;
                const detail = you
                    ? `${other} owes you ${proceeds}`
                    : `You owe ${actor} ${proceeds}`;
                return { title, detail };
            }
            const title = you
                ? `You bought ${qty(e.amount, sym)} of ${on} from ${other}`
                : `${actor} bought ${qty(e.amount, sym)} of ${on} from you`;
            const detail = you
                ? `You owe ${other} ${proceeds}`
                : `${actor} owes you ${proceeds}`;
            return { title, detail };
        }
        default:
            return {
                title: `${kindLabel(e.kind)} · ${qty(e.amount, sym)}`,
                detail: other,
            };
    }
}

export function formatWhen(blockTime?: string): string {
    if (!blockTime) return "";
    const d = new Date(blockTime);
    if (Number.isNaN(d.getTime())) return blockTime;
    return d.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

export function eventKey(e: ActivityEvent): string {
    return [
        e.blockTime ?? "",
        e.kind,
        e.counterparty,
        e.assetId,
        e.amount,
        e.netted,
        e.actor,
        e.requestId ?? 0,
        e.memo ?? "",
    ].join("|");
}

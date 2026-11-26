import { humanToRaw } from "@/lib/amount";
import type {
    BookAuth,
    CreditLine,
    ForwardOffer,
    Obligation,
} from "@/lib/graphql";

export type GroupedAccount = {
    key: string;
    counterparty: string;
    assetId: number;
    obligations: Obligation[];
    /** Sum of obligation amounts, raw units */
    total: bigint;
    /** Matching credit line, if one is extended for this pair/asset */
    creditLine?: CreditLine;
};

export function lineKey(
    creditor: string,
    debtor: string,
    assetId: number,
): string {
    return `${creditor}\0${debtor}\0${assetId}`;
}

export function groupByCounterpartyAndAsset(
    items: Obligation[],
    counterpartyOf: (o: Obligation) => string,
    precisionOf: (assetId: number) => number,
): Map<string, GroupedAccount> {
    const map = new Map<string, GroupedAccount>();
    for (const o of items) {
        const counterparty = counterpartyOf(o);
        const key = `${counterparty}\0${o.assetId}`;
        let g = map.get(key);
        if (!g) {
            g = {
                key,
                counterparty,
                assetId: o.assetId,
                obligations: [],
                total: 0n,
            };
            map.set(key, g);
        }
        g.obligations.push(o);
        g.total += humanToRaw(o.amount || "0", precisionOf(o.assetId));
    }
    return map;
}

/** Pure undrawn facility: no open obligation balance, just a credit line. */
export function isFacilityOnly(g: GroupedAccount): boolean {
    return g.total === 0n && g.obligations.length === 0;
}

function compareByNameThenAsset(a: GroupedAccount, b: GroupedAccount): number {
    const byParty = a.counterparty.localeCompare(b.counterparty);
    if (byParty !== 0) return byParty;
    return a.assetId - b.assetId;
}

/** Balances first (A–Z), then pure credit facilities (A–Z). */
export function sortGroups(groups: GroupedAccount[]): GroupedAccount[] {
    return groups.sort((a, b) => {
        const aFac = isFacilityOnly(a);
        const bFac = isFacilityOnly(b);
        if (aFac !== bFac) return aFac ? 1 : -1;
        return compareByNameThenAsset(a, b);
    });
}

/** One counterparty in one currency: what they owe you and what you owe them. */
export type CounterpartyRow = {
    key: string;
    counterparty: string;
    assetId: number;
    /** What they owe you, raw units. */
    owedToYou: bigint;
    /** What you owe them, raw units. */
    youOwe: bigint;
    /** `owedToYou - youOwe`: positive means they owe you. */
    net: bigint;
    /** False for a pure credit line with no open balance. */
    hasBalance: boolean;
    /** The line you extended to them. */
    lineToThem?: CreditLine;
    /** The line they extended to you. */
    lineFromThem?: CreditLine;
};

/**
 * One row per counterparty and currency. Pairs auto-net on chain, so only one
 * of the two sides normally holds a balance; the other side only adds a line.
 */
export function mergeCounterparties(
    savings: GroupedAccount[],
    loans: GroupedAccount[],
): CounterpartyRow[] {
    const rows = new Map<string, CounterpartyRow>();
    const rowFor = (g: GroupedAccount) => {
        let row = rows.get(g.key);
        if (!row) {
            row = {
                key: g.key,
                counterparty: g.counterparty,
                assetId: g.assetId,
                owedToYou: 0n,
                youOwe: 0n,
                net: 0n,
                hasBalance: false,
            };
            rows.set(g.key, row);
        }
        return row;
    };
    for (const g of savings) {
        const row = rowFor(g);
        row.owedToYou += g.total;
        row.lineToThem = g.creditLine;
        row.hasBalance ||= !isFacilityOnly(g);
    }
    for (const g of loans) {
        const row = rowFor(g);
        row.youOwe += g.total;
        row.lineFromThem = g.creditLine;
        row.hasBalance ||= !isFacilityOnly(g);
    }
    for (const row of rows.values()) row.net = row.owedToYou - row.youOwe;
    return [...rows.values()].sort((a, b) => {
        if (a.hasBalance !== b.hasBalance) return a.hasBalance ? -1 : 1;
        const byParty = a.counterparty.localeCompare(b.counterparty);
        return byParty !== 0 ? byParty : a.assetId - b.assetId;
    });
}

/**
 * How much you could still draw on a line extended to you: `limit - owed`,
 * and no more than what is left when the line depletes. `undefined` when
 * there is no line.
 */
export function drawableRaw(
    line: CreditLine | undefined,
    owed: bigint,
    precision: number,
): bigint | undefined {
    if (!line) return undefined;
    const limit = humanToRaw(line.limit || "0", precision);
    let room = limit > owed ? limit - owed : 0n;
    if (line.depleteOnDebit) {
        const left = humanToRaw(line.remaining || "0", precision);
        if (left < room) room = left;
    }
    return room;
}

/** Currencies other than `selected` in which you have an open balance. */
export function otherCurrenciesWithBalance(
    savings: GroupedAccount[],
    loans: GroupedAccount[],
    selected: number | undefined,
): number[] {
    const ids = new Set<number>();
    for (const g of [...savings, ...loans]) {
        if (g.assetId !== selected && !isFacilityOnly(g)) ids.add(g.assetId);
    }
    return [...ids].sort((a, b) => a - b);
}

/** One currency. `undefined` leaves the list unscoped. */
export function groupsInAsset(
    groups: GroupedAccount[],
    assetId: number | undefined,
): GroupedAccount[] {
    if (assetId === undefined) return groups;
    return groups.filter((g) => g.assetId === assetId);
}

/** Claim balances only. Undrawn facilities stay at zero and do not move the net. */
export function positionTotals(
    savings: GroupedAccount[],
    loans: GroupedAccount[],
): { assets: bigint; liabilities: bigint; net: bigint } {
    const assets = savings.reduce((sum, g) => sum + g.total, 0n);
    const liabilities = loans.reduce((sum, g) => sum + g.total, 0n);
    return { assets, liabilities, net: assets - liabilities };
}

/**
 * Credit-line limits extended to the user, in one currency.
 * `loans` must already be that currency: every limit is scaled with `precision`.
 * Undrawn facilities count. Lines the user extended to others do not.
 */
export function creditExtendedRaw(
    loans: GroupedAccount[],
    precision: number,
): bigint {
    return loans.reduce((sum, g) => {
        const limit = g.creditLine?.limit;
        if (!limit) return sum;
        const raw = humanToRaw(limit, precision);
        return raw > 0n ? sum + raw : sum;
    }, 0n);
}

/** Attach lines; also add undrawn facilities so limits show with 0 balance. */
export function mergeCreditLines(
    groups: Map<string, GroupedAccount>,
    lines: CreditLine[],
    role: "savings" | "loan",
    user: string,
): GroupedAccount[] {
    const byLine = new Map(
        lines.map((l) => [lineKey(l.creditor, l.debtor, l.assetId), l]),
    );

    for (const g of groups.values()) {
        const key =
            role === "loan"
                ? lineKey(g.counterparty, user, g.assetId)
                : lineKey(user, g.counterparty, g.assetId);
        g.creditLine = byLine.get(key);
    }

    for (const line of lines) {
        const isLoan = line.debtor === user;
        const isSavings = line.creditor === user;
        if (role === "loan" && !isLoan) continue;
        if (role === "savings" && !isSavings) continue;

        const counterparty = role === "loan" ? line.creditor : line.debtor;
        const key = `${counterparty}\0${line.assetId}`;
        if (groups.has(key)) continue;

        groups.set(key, {
            key,
            counterparty,
            assetId: line.assetId,
            obligations: [],
            total: 0n,
            creditLine: line,
        });
    }

    return sortGroups([...groups.values()]);
}

export function liveBookAuth(
    auths: BookAuth[],
    debtor: string,
    creditor: string,
    assetId: number,
): BookAuth | undefined {
    const now = Date.now();
    return auths.find(
        (a) =>
            a.debtor === debtor &&
            a.creditor === creditor &&
            a.assetId === assetId &&
            (!a.expiresAt || a.expiresAt * 1000 >= now),
    );
}

export function liveGlobalForward(
    offers: ForwardOffer[],
    assetId: number | undefined,
    nowSec: number,
): boolean {
    if (assetId === undefined) return false;
    return offers.some(
        (p) =>
            p.isGlobal &&
            p.assetId === assetId &&
            (p.expiresAt === 0 || p.expiresAt >= nowSec),
    );
}

export function spendableBookAuth(
    auths: BookAuth[],
    debtor: string,
    creditor: string,
    assetId: number,
): BookAuth | undefined {
    const auth = liveBookAuth(auths, debtor, creditor, assetId);
    return auth && Number(auth.remaining) > 0 ? auth : undefined;
}

export function accountHref(account: string): string {
    return `/accounts/${encodeURIComponent(account)}`;
}

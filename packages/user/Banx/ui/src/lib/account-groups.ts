import { humanToRaw } from "@/lib/amount";
import type {
    BookAuth,
    CreditLine,
    ForwardOffer,
    Obligation,
} from "@/lib/graphql";

export function totalRaw(
    principal: string,
    interest: string,
    precision: number,
): bigint {
    return (
        humanToRaw(principal || "0", precision) +
        humanToRaw(interest || "0", precision)
    );
}

export type GroupedAccount = {
    key: string;
    counterparty: string;
    assetId: number;
    obligations: Obligation[];
    /** Principal + interest combined */
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
        g.total += totalRaw(
            o.remainingPrincipal,
            o.accruedInterest,
            precisionOf(o.assetId),
        );
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

export function filterGroups(
    groups: GroupedAccount[],
    hideEmptyFacilities: boolean,
): GroupedAccount[] {
    if (!hideEmptyFacilities) return groups;
    return groups.filter((g) => !isFacilityOnly(g));
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

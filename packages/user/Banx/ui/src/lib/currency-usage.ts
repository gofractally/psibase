import {
    creditExtendedRaw,
    type GroupedAccount,
} from "@/lib/account-groups";
import { eventTouchesAsset } from "@/lib/activity";
import { formatRawAmount } from "@/lib/amount";
import type { ActivityEvent, Asset } from "@/lib/graphql";

/** One registered currency, plus whether this account has touched it. */
export type CurrencyUsage = {
    asset: Asset;
    held: bigint;
    owed: bigint;
    /** Credit-line limits extended to the user. */
    limit: bigint;
    /** Credit-line limits the user extended to others. */
    offered: bigint;
    /**
     * A live balance, a credit line either way, or an activity event.
     * The activity feed is the newest slice, so a long-settled currency can
     * fall out of "in use" once nothing is open.
     */
    inUse: boolean;
};

export function currencyUsage(
    assets: Asset[],
    savings: GroupedAccount[],
    loans: GroupedAccount[],
    events: ActivityEvent[],
): CurrencyUsage[] {
    return assets.map((asset) => {
        const savingsHere = savings.filter((g) => g.assetId === asset.id);
        const loansHere = loans.filter((g) => g.assetId === asset.id);
        const held = savingsHere.reduce((sum, g) => sum + g.total, 0n);
        const owed = loansHere.reduce((sum, g) => sum + g.total, 0n);
        const limit = creditExtendedRaw(loansHere, asset.precision);
        const offered = creditExtendedRaw(savingsHere, asset.precision);
        const seen = events.some((event) => eventTouchesAsset(event, asset.id));
        return {
            asset,
            held,
            owed,
            limit,
            offered,
            inUse: seen || savingsHere.length > 0 || loansHere.length > 0,
        };
    });
}

/** Open positions first, then facilities, then history with a flat balance. */
export function splitCurrencyUsage(rows: CurrencyUsage[]): {
    active: CurrencyUsage[];
    unused: CurrencyUsage[];
} {
    const active: CurrencyUsage[] = [];
    const unused: CurrencyUsage[] = [];
    for (const row of rows) {
        (row.inUse ? active : unused).push(row);
    }
    const weight = (row: CurrencyUsage) => {
        if (row.held !== 0n || row.owed !== 0n) return 0;
        if (row.limit > 0n || row.offered > 0n) return 1;
        return 2;
    };
    active.sort(
        (a, b) =>
            weight(a) - weight(b) ||
            a.asset.symbol.localeCompare(b.asset.symbol),
    );
    unused.sort((a, b) => a.asset.symbol.localeCompare(b.asset.symbol));
    return { active, unused };
}

export function currencyMatches(row: CurrencyUsage, query: string): boolean {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return (
        row.asset.symbol.toLowerCase().includes(needle) ||
        row.asset.description.toLowerCase().includes(needle)
    );
}

export function precisionLabel(precision: number): string {
    return precision === 1 ? "1 decimal" : `${precision} decimals`;
}

/** Position line for an in-use currency. Unused currencies omit it. */
export function currencyStatus(row: CurrencyUsage): string | undefined {
    const fmt = (amount: bigint) =>
        formatRawAmount(amount.toString(), row.asset.precision);
    const bits: string[] = [];
    if (row.owed > 0n && row.limit > 0n) {
        bits.push(`Owe ${fmt(row.owed)} of ${fmt(row.limit)}`);
    } else if (row.owed > 0n) {
        bits.push(`Owe ${fmt(row.owed)}`);
    } else if (row.limit > 0n) {
        bits.push(`Limit ${fmt(row.limit)}, undrawn`);
    }
    if (row.held > 0n) bits.push(`Hold ${fmt(row.held)}`);
    if (bits.length === 0 && row.offered > 0n) {
        bits.push(`Credit offered ${fmt(row.offered)}`);
    }
    if (bits.length > 0) return bits.join(" · ");
    if (row.inUse) return "No open balance";
    return undefined;
}

/** Signed net when there is a balance. `null` when both sides are zero. */
export function currencyNet(row: CurrencyUsage): bigint | null {
    if (row.held === 0n && row.owed === 0n) return null;
    return row.held - row.owed;
}

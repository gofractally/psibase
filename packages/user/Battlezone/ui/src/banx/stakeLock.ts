import { quotePath, type PathQuote } from "./client";

export type BanxProposal = {
    account: string;
    assetId: number;
    symbol: string;
    /** Human decimal string */
    units: string;
};

export type LockedPairStake = {
    a: string;
    b: string;
    aPays: string;
    aAsset: number;
    aSymbol: string;
    bPays: string;
    bAsset: number;
    bSymbol: string;
    /** Frozen min-return when A pays B (in B's asset) */
    aMinReturn: string;
    /** Frozen min-return when B pays A (in A's asset) */
    bMinReturn: string;
};

export type StakeBumpOffer = {
    /** Account that must accept/reject the bump */
    lowAccount: string;
    peerAccount: string;
    requiredUnits: string;
    requiredAsset: number;
    requiredSymbol: string;
    matchPeerUnits: string;
    matchPeerAsset: number;
    matchPeerSymbol: string;
    /** Preview of the lock if accepted */
    pendingLock: LockedPairStake;
};

export type PairReconcileResult =
    | { status: "locked"; lock: LockedPairStake }
    | { status: "offer"; offer: StakeBumpOffer }
    | { status: "noPath"; reason: string }
    | { status: "error"; reason: string };

const EPS = 1e-9;

export function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function amountFor(
    lock: LockedPairStake,
    account: string,
): string | null {
    if (account === lock.a) return lock.aPays;
    if (account === lock.b) return lock.bPays;
    return null;
}

export function assetFor(
    lock: LockedPairStake,
    account: string,
): number | null {
    if (account === lock.a) return lock.aAsset;
    if (account === lock.b) return lock.bAsset;
    return null;
}

export function symbolFor(
    lock: LockedPairStake,
    account: string,
): string | null {
    if (account === lock.a) return lock.aSymbol;
    if (account === lock.b) return lock.bSymbol;
    return null;
}

export function minReturnForPayer(
    lock: LockedPairStake,
    payer: string,
): string | null {
    if (payer === lock.a) return lock.aMinReturn;
    if (payer === lock.b) return lock.bMinReturn;
    return null;
}

export function findLock(
    locks: LockedPairStake[],
    a: string,
    b: string,
): LockedPairStake | undefined {
    const key = pairKey(a, b);
    return locks.find((l) => pairKey(l.a, l.b) === key);
}

function parseAmount(s: string): number {
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
}

function nearlyEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

function normalizeAccounts(
    a: BanxProposal,
    b: BanxProposal,
): [BanxProposal, BanxProposal] {
    return a.account < b.account ? [a, b] : [b, a];
}

/**
 * Title-time equal-value reconciliation for one Banx-on pair.
 * Uses live quotes once; caller freezes the result for the match.
 */
export async function reconcilePair(
    left: BanxProposal,
    right: BanxProposal,
): Promise<PairReconcileResult> {
    const [a, b] = normalizeAccounts(left, right);

    // Same asset: numeric compare, no FX.
    if (a.assetId === b.assetId) {
        const ua = parseAmount(a.units);
        const ub = parseAmount(b.units);
        if (!Number.isFinite(ua) || !Number.isFinite(ub) || ua <= 0 || ub <= 0) {
            return { status: "error", reason: "invalid units" };
        }
        // Verify a path exists both ways with exact-in of the high stake.
        const high = Math.max(ua, ub);
        const highStr = String(high);
        try {
            const qAb = await quotePath({
                fromAccount: a.account,
                toAccount: b.account,
                amount: highStr,
                fromAsset: a.assetId,
                toAsset: b.assetId,
                exactOut: false,
            });
            const qBa = await quotePath({
                fromAccount: b.account,
                toAccount: a.account,
                amount: highStr,
                fromAsset: b.assetId,
                toAsset: a.assetId,
                exactOut: false,
            });
            const lock: LockedPairStake = {
                a: a.account,
                b: b.account,
                aPays: highStr,
                aAsset: a.assetId,
                aSymbol: a.symbol,
                bPays: highStr,
                bAsset: b.assetId,
                bSymbol: b.symbol,
                aMinReturn: qAb.minReturn,
                bMinReturn: qBa.minReturn,
            };
            if (nearlyEqual(ua, ub)) {
                return { status: "locked", lock };
            }
            const lowIsA = ua < ub;
            const low = lowIsA ? a : b;
            const highP = lowIsA ? b : a;
            return {
                status: "offer",
                offer: {
                    lowAccount: low.account,
                    peerAccount: highP.account,
                    requiredUnits: highStr,
                    requiredAsset: low.assetId,
                    requiredSymbol: low.symbol,
                    matchPeerUnits: highP.units,
                    matchPeerAsset: highP.assetId,
                    matchPeerSymbol: highP.symbol,
                    pendingLock: lock,
                },
            };
        } catch (e) {
            return {
                status: "noPath",
                reason: e instanceof Error ? e.message : String(e),
            };
        }
    }

    // Cross-asset: size via exact-out quotes.
    let aValueInB: PathQuote;
    let bValueInA: PathQuote;
    try {
        aValueInB = await quotePath({
            fromAccount: b.account,
            toAccount: a.account,
            amount: a.units,
            fromAsset: b.assetId,
            toAsset: a.assetId,
            exactOut: true,
        });
        bValueInA = await quotePath({
            fromAccount: a.account,
            toAccount: b.account,
            amount: b.units,
            fromAsset: a.assetId,
            toAsset: b.assetId,
            exactOut: true,
        });
    } catch (e) {
        return {
            status: "noPath",
            reason: e instanceof Error ? e.message : String(e),
        };
    }

    const aInB = parseAmount(aValueInB.amountIn);
    const bInA = parseAmount(bValueInA.amountIn);
    const ua = parseAmount(a.units);
    const ub = parseAmount(b.units);
    if (![aInB, bInA, ua, ub].every(Number.isFinite)) {
        return { status: "error", reason: "bad quote amounts" };
    }

    // Also freeze exact-in settlement quotes at the locked sizes.
    const buildLock = async (
        aPays: string,
        bPays: string,
    ): Promise<LockedPairStake | { error: string }> => {
        try {
            const qAb = await quotePath({
                fromAccount: a.account,
                toAccount: b.account,
                amount: aPays,
                fromAsset: a.assetId,
                toAsset: b.assetId,
                exactOut: false,
            });
            const qBa = await quotePath({
                fromAccount: b.account,
                toAccount: a.account,
                amount: bPays,
                fromAsset: b.assetId,
                toAsset: a.assetId,
                exactOut: false,
            });
            return {
                a: a.account,
                b: b.account,
                aPays,
                aAsset: a.assetId,
                aSymbol: a.symbol,
                bPays,
                bAsset: b.assetId,
                bSymbol: b.symbol,
                aMinReturn: qAb.minReturn,
                bMinReturn: qBa.minReturn,
            };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    };

    // A's proposal (valued in B's asset) is larger than B's units → B bumps.
    if (aInB > ub + EPS) {
        const lockOrErr = await buildLock(a.units, aValueInB.amountIn);
        if ("error" in lockOrErr) {
            return { status: "noPath", reason: lockOrErr.error };
        }
        return {
            status: "offer",
            offer: {
                lowAccount: b.account,
                peerAccount: a.account,
                requiredUnits: aValueInB.amountIn,
                requiredAsset: b.assetId,
                requiredSymbol: b.symbol,
                matchPeerUnits: a.units,
                matchPeerAsset: a.assetId,
                matchPeerSymbol: a.symbol,
                pendingLock: lockOrErr,
            },
        };
    }

    // B's proposal (valued in A's asset) is larger than A's units → A bumps.
    if (bInA > ua + EPS) {
        const lockOrErr = await buildLock(bValueInA.amountIn, b.units);
        if ("error" in lockOrErr) {
            return { status: "noPath", reason: lockOrErr.error };
        }
        return {
            status: "offer",
            offer: {
                lowAccount: a.account,
                peerAccount: b.account,
                requiredUnits: bValueInA.amountIn,
                requiredAsset: a.assetId,
                requiredSymbol: a.symbol,
                matchPeerUnits: b.units,
                matchPeerAsset: b.assetId,
                matchPeerSymbol: b.symbol,
                pendingLock: lockOrErr,
            },
        };
    }

    // Equal (within tolerance).
    const lockOrErr = await buildLock(a.units, b.units);
    if ("error" in lockOrErr) {
        return { status: "noPath", reason: lockOrErr.error };
    }
    return { status: "locked", lock: lockOrErr };
}

import type { CreditLine } from "@/lib/graphql";

export type NetNode = {
    id: string;
    label: string;
    you: boolean;
    /** You extended this account a line. */
    extended: boolean;
    /** This account extended you a line. */
    received: boolean;
};

export type NetLink = {
    source: string;
    target: string;
    assetId: number;
    /** You are the creditor on this line. */
    extended: boolean;
    /** You are the debtor on this line. */
    received: boolean;
    curve: number;
};

/**
 * One node per account, one directed link per credit line (creditor → debtor).
 * Parallel lines between the same pair curve apart so each asset stays visible.
 */
export function buildNetworkGraph(
    lines: CreditLine[],
    user: string | undefined,
    labelOf: (account: string) => string,
): { nodes: NetNode[]; links: NetLink[] } {
    const ids = new Set<string>();
    if (user) ids.add(user);
    for (const line of lines) {
        ids.add(line.creditor);
        ids.add(line.debtor);
    }

    const extendedTo = new Set<string>();
    const receivedFrom = new Set<string>();
    if (user) {
        for (const line of lines) {
            if (line.creditor === user) extendedTo.add(line.debtor);
            if (line.debtor === user) receivedFrom.add(line.creditor);
        }
    }

    const nodes: NetNode[] = [...ids].map((id) => ({
        id,
        label: id === user ? "You" : labelOf(id),
        you: id === user,
        extended: id !== user && extendedTo.has(id),
        received: id !== user && receivedFrom.has(id),
    }));
    nodes.sort(
        (a, b) =>
            Number(b.you) - Number(a.you) ||
            Number(b.extended) - Number(a.extended) ||
            a.label.localeCompare(b.label),
    );

    const buckets = new Map<string, { line: CreditLine; dir: number }[]>();
    for (const line of lines) {
        const forward = line.creditor < line.debtor;
        const key = forward
            ? `${line.creditor}\0${line.debtor}`
            : `${line.debtor}\0${line.creditor}`;
        const item = { line, dir: forward ? 1 : -1 };
        const bucket = buckets.get(key);
        if (bucket) bucket.push(item);
        else buckets.set(key, [item]);
    }

    const links: NetLink[] = [];
    for (const bucket of buckets.values()) {
        bucket.sort((a, b) => a.line.assetId - b.line.assetId);
        const mid = (bucket.length - 1) / 2;
        for (let index = 0; index < bucket.length; index++) {
            const { line, dir } = bucket[index]!;
            links.push({
                source: line.creditor,
                target: line.debtor,
                assetId: line.assetId,
                extended: !!user && line.creditor === user,
                received: !!user && line.debtor === user,
                curve: dir * (index - mid) * 0.28,
            });
        }
    }

    return { nodes, links };
}

import type { CreditLine, ForwardOffer } from "@/lib/graphql";

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
    /** Path-pay hop. Dashed, drawn on the credit line. */
    path: boolean;
    /** Credit runs both ways, so this solid line has an arrow at each end. */
    both: boolean;
    curve: number;
};

type RawLink = Omit<NetLink, "curve">;

/**
 * A posted line lets the debtor draw. Path pay can hop that line only when
 * the debtor is forwarding to that creditor (specific offer, or global).
 * The hop points at the creditor: that is the direction value travels.
 */
function pathHops(lines: CreditLine[], offers: ForwardOffer[]): RawLink[] {
    const specific = new Map<string, ForwardOffer>();
    const global = new Map<string, ForwardOffer>();
    for (const offer of offers) {
        if (offer.isGlobal) {
            global.set(`${offer.poster}\0${offer.assetId}`, offer);
            continue;
        }
        if (!offer.nextHop || offer.nextHop === "0") continue;
        specific.set(
            `${offer.poster}\0${offer.nextHop}\0${offer.assetId}`,
            offer,
        );
    }

    const hops: RawLink[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
        if (line.creditor === line.debtor) continue;
        const pair = `${line.debtor}\0${line.creditor}\0${line.assetId}`;
        const offer =
            specific.get(pair) ??
            global.get(`${line.debtor}\0${line.assetId}`);
        if (!offer) continue;
        if (line.interestRatePpm > offer.maxLineAprPpm) continue;
        if (!offer.allowUnknown) {
            const knows = lines.some(
                (back) =>
                    back.creditor === line.debtor &&
                    back.debtor === line.creditor &&
                    back.assetId === line.assetId,
            );
            if (!knows) continue;
        }
        if (seen.has(pair)) continue;
        seen.add(pair);
        hops.push({
            source: line.debtor,
            target: line.creditor,
            assetId: line.assetId,
            extended: false,
            received: false,
            path: true,
            both: false,
        });
    }
    return hops;
}

/**
 * One node per account. Credit in both directions is one solid line with
 * `both` set. A path hop stays a separate dashed link on that same curve,
 * so it does not replace the credit line. Parallel assets still curve apart.
 */
export function buildNetworkGraph(
    lines: CreditLine[],
    offers: ForwardOffer[],
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

    const creditRaw: RawLink[] = lines.map((line) => ({
        source: line.creditor,
        target: line.debtor,
        assetId: line.assetId,
        extended: !!user && line.creditor === user,
        received: !!user && line.debtor === user,
        path: false,
        both: false,
    }));

    const groups = new Map<
        string,
        { low: string; high: string; forward?: RawLink; back?: RawLink }
    >();
    for (const link of creditRaw) {
        const low = link.source < link.target ? link.source : link.target;
        const high = link.source < link.target ? link.target : link.source;
        const key = `${low}\0${high}\0${link.assetId}`;
        const group = groups.get(key) ?? { low, high };
        if (link.source === low) group.forward = link;
        else group.back = link;
        groups.set(key, group);
    }

    const credit: NetLink[] = [];
    for (const group of groups.values()) {
        const { forward, back } = group;
        if (forward && back) {
            credit.push({
                source: group.low,
                target: group.high,
                assetId: forward.assetId,
                extended: forward.extended || back.extended,
                received: forward.received || back.received,
                path: false,
                both: true,
                curve: 0,
            });
        } else if (forward) {
            credit.push({ ...forward, curve: 0 });
        } else if (back) {
            credit.push({ ...back, curve: 0 });
        }
    }

    const buckets = new Map<string, NetLink[]>();
    for (const link of credit) {
        const low = link.source < link.target ? link.source : link.target;
        const high = link.source < link.target ? link.target : link.source;
        const key = `${low}\0${high}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(link);
        else buckets.set(key, [link]);
    }

    const placed = new Map<string, NetLink>();
    for (const bucket of buckets.values()) {
        bucket.sort((a, b) => a.assetId - b.assetId);
        const mid = (bucket.length - 1) / 2;
        for (let index = 0; index < bucket.length; index++) {
            const link = bucket[index]!;
            link.curve = (index - mid) * 0.28;
            const low = link.source < link.target ? link.source : link.target;
            const high = link.source < link.target ? link.target : link.source;
            placed.set(`${low}\0${high}\0${link.assetId}`, link);
        }
    }

    // Same curve as the credit line, negated when the hop runs the other way,
    // so the dash sits on the credit line instead of bowing out beside it.
    const paths: NetLink[] = pathHops(lines, offers).map((link) => {
        const low = link.source < link.target ? link.source : link.target;
        const high = link.source < link.target ? link.target : link.source;
        const creditLink = placed.get(`${low}\0${high}\0${link.assetId}`);
        const same =
            !!creditLink &&
            link.source === creditLink.source &&
            link.target === creditLink.target;
        return {
            ...link,
            curve: creditLink ? (same ? creditLink.curve : -creditLink.curve) : 0,
        };
    });

    return { nodes, links: [...credit, ...paths] };
}

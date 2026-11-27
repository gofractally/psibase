// What the auth service knows about the accounts a user is recovery partner
// for (gofractally/psibase#2275, section 5).
import { graphql } from "@shared/lib/graphql";
import { type Account, zAccount } from "@shared/lib/schemas/account";
import { supervisor } from "@shared/lib/supervisor";

const authSig = zAccount.parse("auth-sig");

export const PAGE_SIZE = 25;

export type PartnerKey = { key: string; seq: string };

export type RecoveryRequest = {
    id: number;
    owner: PartnerKey;
    active: PartnerKey;
    time: string;
};

export type PartnerAccount = {
    account: string;
    state: "normal" | "paused" | "frozen";
    stateSince?: string | null;
    stateUntil?: string | null;
    owner: PartnerKey;
    pending?: {
        kind: "ownerKeys" | "partner" | "delays";
        owner?: PartnerKey | null;
        partner?: string | null;
        pauseSeconds?: number | null;
        freezeSeconds?: number | null;
        requested: string;
    } | null;
    recoveryRequests: RecoveryRequest[];
};

export type PartnerPage = {
    accounts: PartnerAccount[];
    endCursor?: string;
    hasNextPage: boolean;
};

const NODE = `account state stateSince stateUntil owner { key seq }
    pending { kind owner { key seq } partner pauseSeconds freezeSeconds requested }
    recoveryRequests { id owner { key seq } active { key seq } time }`;

type Connection = {
    edges: { node: PartnerAccount }[];
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
};

const normalize = (node: PartnerAccount): PartnerAccount => ({
    ...node,
    state: String(node.state).toLowerCase() as PartnerAccount["state"],
    recoveryRequests: node.recoveryRequests ?? [],
});

const toPage = (connection: Connection): PartnerPage => ({
    accounts: connection.edges.map((edge) => normalize(edge.node)),
    endCursor: connection.pageInfo.endCursor ?? undefined,
    hasNextPage: connection.pageInfo.hasNextPage,
});

const quote = (value: string) => JSON.stringify(value);

/**
 * One page of the accounts `partner` is recovery partner for, in name order.
 * `prefix` narrows it to names that start with it, so a partner with many
 * accounts jumps to one instead of paging to it.
 */
export const fetchPartnerAccounts = async (
    partner: Account,
    options: { after?: string; prefix?: string; first?: number } = {},
): Promise<PartnerPage> => {
    const args = [
        `partner: ${quote(partner)}`,
        `first: ${options.first ?? PAGE_SIZE}`,
        options.after ? `after: ${quote(options.after)}` : "",
        // Account names sort as their text does within one length class, so
        // the range is a lower bound; the page is cut at the first name that
        // no longer matches (see the hook).
        options.prefix ? `ge: ${quote(options.prefix)}` : "",
    ]
        .filter(Boolean)
        .join(", ");
    const data = await graphql<{ accountsByPartner: Connection }>(
        `{ accountsByPartner(${args}) { edges { node { ${NODE} } } pageInfo { hasNextPage endCursor } } }`,
        { service: authSig },
    );
    return toPage(data.accountsByPartner);
};

/** Whether `partner` is the recovery partner of at least one other account. */
export const fetchIsPartner = async (partner: Account): Promise<boolean> => {
    const data = await graphql<{
        accountsByPartner: { edges: { node: { account: string } }[] };
    }>(
        `{ accountsByPartner(partner: ${quote(partner)}, first: 2) { edges { node { account } } } }`,
        { service: authSig },
    );
    return data.accountsByPartner.edges.some(
        (edge) => edge.node.account !== partner,
    );
};

/**
 * The accounts that are waiting for `partner`: paused (with the change that
 * is pending, if any) or frozen (with the keys proposed for them).
 */
export const fetchPartnerRequests = async (
    partner: Account,
    after?: string,
): Promise<PartnerPage> => {
    const args = [
        `partner: ${quote(partner)}`,
        `first: ${PAGE_SIZE}`,
        after ? `after: ${quote(after)}` : "",
    ]
        .filter(Boolean)
        .join(", ");
    const data = await graphql<{ requestsForPartner: Connection }>(
        `{ requestsForPartner(${args}) { edges { node { ${NODE} } } pageInfo { hasNextPage endCursor } } }`,
        { service: authSig },
    );
    const page = toPage(data.requestsForPartner);
    // An account whose pause ran out since its record was last written is
    // still indexed as waiting; it has nothing to decide.
    return {
        ...page,
        accounts: page.accounts.filter((a) => a.state !== "normal"),
    };
};

export type PartnerDecision =
    | { kind: "confirm"; account: string }
    | { kind: "reject"; account: string }
    | { kind: "endPause"; account: string }
    | { kind: "unfreeze"; account: string; requestId: number }
    | { kind: "rejectRecovery"; account: string; requestId: number };

/** Sends the partner's decision as a transaction from the current user. */
export const sendDecision = async (decision: PartnerDecision) => {
    const params =
        decision.kind === "unfreeze" || decision.kind === "rejectRecovery"
            ? [decision.account, decision.requestId]
            : [decision.account];
    await supervisor.functionCall({
        service: authSig,
        intf: "partner",
        method: decision.kind,
        params,
    });
};

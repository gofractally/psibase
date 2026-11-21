import type { Api, Activity, Contact, Line, Page, PaymentRequest, Quote, Settings } from "./types";
let supervisor: Awaited<ReturnType<typeof getSupervisor>> | undefined;
async function getSupervisor() {
    return (await import("@psibase/common-lib")).getSupervisor();
}
async function call(
    service: string,
    intf: string,
    method: string,
    params: unknown[] = [],
    plugin?: string,
): Promise<any> {
    supervisor ??= await getSupervisor();
    return supervisor.functionCall({
        service,
        intf,
        method,
        params,
        ...(plugin ? { plugin } : {}),
    });
}
let legacyAccounts = false;
async function currentUser(): Promise<string | null> {
    // Older chains expose these functions through accounts; newer chains moved
    // them to host/accounts. Probe a method on the existing query plugin first.
    try {
        const user = await call("accounts", "api", "getCurrentUser", [], "query");
        legacyAccounts = true;
        return user;
    } catch (error) {
        if (
            !/Unrecognized call:.*get-current-user|Unknown.*get-current-user|not found.*get-current-user/i.test(
                String((error as Error)?.message),
            )
        )
            throw error;
        legacyAccounts = false;
        return call("host", "api", "getCurrentUser", [], "accounts");
    }
}
const q = JSON.stringify;
async function graphql<T>(query: string): Promise<T> {
    const raw = await call("favor", "authorized", "graphql", [query]);
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (result.errors?.length)
        throw new Error(result.errors.map((e: { message: string }) => e.message).join("; "));
    if (!result.data) throw new Error("The network did not return a response.");
    return result.data;
}
const lineFields =
    "peer symbol youExtend theyExtend theyOwe youOwe canPay canReceive yourFeePpm theirFeePpm forwarding theirForwarding cursor";
const activityFields = "id kind symbol incoming outgoing received sent earned memo time";
const requestFields = "hash symbol amount expiresAt payer consumed revoked";
const pageFields = "endCursor hasNextPage";
async function allPages<T>(field: string, fields: string): Promise<T[]> {
    const nodes: T[] = [];
    let after: string | null = null;
    for (;;) {
        const data: Record<string, Page<T>> = await graphql(
            `{ ${field}(first:100${after ? `,after:${q(after)}` : ""}) { nodes { ${fields} } ${pageFields} } }`,
        );
        const page: Page<T> = data[field];
        nodes.push(...page.nodes);
        if (!page.hasNextPage) return nodes;
        if (!page.endCursor || page.endCursor === after)
            throw new Error("Unable to load the next page.");
        after = page.endCursor;
    }
}
export const liveApi: Api = {
    user: currentUser,
    connect: async () => {
        await call(
            legacyAccounts ? "accounts" : "host",
            "activeApp",
            "connectAccount",
            [],
            legacyAccounts ? "plugin" : "accounts",
        );
    },
    logout: async () => {
        await call(
            legacyAccounts ? "accounts" : "host",
            "activeApp",
            "logout",
            [],
            legacyAccounts ? "plugin" : "accounts",
        );
    },
    async snapshot() {
        const [lines, requests, data] = await Promise.all([
            allPages<Line>("lines", lineFields),
            allPages<PaymentRequest>("requests", requestFields),
            graphql<{ activity: Page<Activity>; settings: Settings }>(
                `{ activity(first:30) { nodes { ${activityFields} } ${pageFields} } settings { requestOnly routingReady serverTime } }`,
            ),
        ]);
        return { lines, requests, ...data };
    },
    contacts: () => call("profiles", "contacts", "get"),
    saveContact: async (contact: Contact) => {
        await call("profiles", "contacts", "set", [contact, false]);
    },
    setLine: async (...params) => {
        await call("favor", "api", "setLine", params);
    },
    async quote(peer, symbol, amount, reference, request) {
        const data = await graphql<{ quote: Quote }>(
            `{ quote(payee:${q(peer)},symbol:${q(symbol)},amount:${q(amount)},reference:${q(reference)}${request ? `,requestSecret:${q(request)}` : ""}) { amount fee total symbol payee expiresAt reference encodedRoute } }`,
        );
        return data.quote;
    },
    async pay(quote, memo) {
        await call("favor", "api", "pay", [
            quote.payee,
            quote.symbol,
            quote.amount,
            quote.total,
            quote.encodedRoute,
            quote.reference,
            memo,
        ]);
    },
    settle: async (...params) => {
        await call("favor", "api", "settle", params);
    },
    setReceiving: async (only) => {
        await call("favor", "api", "setReceiving", [only]);
    },
    createRequest: async (...params) => {
        await call("favor", "api", "createRequest", params);
    },
    revokeRequest: async (hash) => {
        await call("favor", "api", "revokeRequest", [hash]);
    },
    async activity(before) {
        const data = await graphql<{ activity: Page<Activity> }>(
            `{ activity(first:30,before:${q(before)}) { nodes { ${activityFields} } ${pageFields} } }`,
        );
        return data.activity;
    },
};

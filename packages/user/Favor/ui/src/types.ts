export interface Contact {
    account: string;
    nickname?: string;
    email?: string;
    phone?: string;
}
export interface Line {
    peer: string;
    symbol: string;
    youExtend: string;
    theyExtend: string;
    theyOwe: string;
    youOwe: string;
    canPay: string;
    canReceive: string;
    yourFeePpm: number;
    theirFeePpm: number;
    forwarding: boolean;
    theirForwarding: boolean;
    cursor: string;
}
export interface Activity {
    id: string;
    kind: string;
    symbol: string;
    incoming: string | null;
    outgoing: string | null;
    received: string;
    sent: string;
    earned: string;
    memo: string;
    time: string;
}
export interface PaymentRequest {
    hash: string;
    symbol: string;
    amount: string;
    expiresAt: string;
    payer: string | null;
    consumed: boolean;
    revoked: boolean;
}
export interface Settings {
    requestOnly: boolean;
    routingReady: boolean;
    serverTime: string;
}
export interface Quote {
    amount: string;
    fee: string;
    total: string;
    symbol: string;
    payee: string;
    expiresAt: string;
    reference: string;
    encodedRoute: string;
}
export interface Page<T> {
    nodes: T[];
    endCursor: string | null;
    hasNextPage: boolean;
}
export interface Snapshot {
    lines: Line[];
    activity: Page<Activity>;
    requests: PaymentRequest[];
    settings: Settings;
}
export interface Api {
    user(): Promise<string | null>;
    connect(): Promise<void>;
    logout(): Promise<void>;
    snapshot(): Promise<Snapshot>;
    contacts(): Promise<Contact[]>;
    saveContact(contact: Contact): Promise<void>;
    setLine(
        peer: string,
        symbol: string,
        limit: string,
        fee: number,
        forward: boolean,
    ): Promise<void>;
    quote(
        peer: string,
        symbol: string,
        amount: string,
        reference: string,
        request: string,
    ): Promise<Quote>;
    pay(quote: Quote, memo: string): Promise<void>;
    settle(peer: string, symbol: string, amount: string, reference: string): Promise<void>;
    setReceiving(requestOnly: boolean): Promise<void>;
    createRequest(
        hash: string,
        symbol: string,
        amount: string,
        expiry: string,
        payer: string | null,
    ): Promise<void>;
    revokeRequest(hash: string): Promise<void>;
    activity(before: string): Promise<Page<Activity>>;
}

export type Peer = {
    id: number;
    endpoint: string;
    url?: string;
};

export type PeerState = "transient" | "backup" | "persistent" | "disabled";
export const isConfigured = (s: PeerState) =>
    s == "persistent" || s == "backup";
export const isConnected = (s: PeerState) =>
    s == "transient" || s == "persistent";

export type PeerSpec = {
    endpoint: string;
    url: string;
    id: number;
    state: PeerState;
};

export type ConnectInputs = {
    url: string;
};

export type AddConnectionInputs = {
    url: string;
    state: PeerState;
};

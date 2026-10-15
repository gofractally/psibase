import type {
    BlockHeader,
    BlockRecord,
    Connection,
    ConsensusData,
    Producer,
    TransactionLocation,
} from "./types";

import { getJson } from "@psibase/common-lib";

import { graphqlAuth } from "@shared/lib/graphql/graphql-auth";
import { callPluginFunction } from "@shared/lib/plugins";

import { type BlockRange, explorer } from "./plugin";

export const gqlString = (value: string) => JSON.stringify(value);

const parseOptional = <T>(json: string | undefined): T | null =>
    json === undefined ? null : (JSON.parse(json) as T);

// ---------------------------------------------------------------------------
// Explorer service (block log)
//
// Block and transaction lookups go through the explorer plugin, which sends the
// logged-in user's credentials (the service redacts transactions the viewer is
// not a party to) and decodes action payloads into `data`.
// ---------------------------------------------------------------------------

export type BlockRangeArgs = BlockRange;

export const fetchBlocks = async (
    args: BlockRangeArgs,
): Promise<Connection<BlockRecord>> =>
    JSON.parse(
        await callPluginFunction(explorer.blockLog.getBlocks, [args]),
    ) as Connection<BlockRecord>;

/** Full block including decoded action payloads, merkle roots, and consensus changes. */
export const fetchBlock = async (
    blockNum: number,
): Promise<BlockRecord | null> =>
    parseOptional<BlockRecord>(
        await callPluginFunction(explorer.blockLog.getBlock, [blockNum]),
    );

/** Block without action payloads. */
export const fetchBlockSummary = async (
    blockNum: number,
): Promise<BlockRecord | null> =>
    parseOptional<BlockRecord>(
        await callPluginFunction(explorer.blockLog.getBlockSummary, [blockNum]),
    );

export const fetchBlockHeader = async (
    blockNum: number,
): Promise<BlockHeader | null> =>
    (await callPluginFunction(explorer.blockLog.getBlockHeader, [blockNum])) ??
    null;

export const fetchHead = async (): Promise<BlockHeader | null> =>
    (await callPluginFunction(explorer.blockLog.getHead, [])) ?? null;

export const findTransaction = async (
    id: string,
    maxBlocks?: number,
): Promise<TransactionLocation | null> =>
    parseOptional<TransactionLocation>(
        await callPluginFunction(explorer.blockLog.findTransaction, [
            id,
            maxBlocks,
        ]),
    );

// ---------------------------------------------------------------------------
// Producers
// ---------------------------------------------------------------------------

export interface CandidateInfo {
    account: string;
    endpoint: string;
    claim: { service: string; rawData: string };
}

export interface ProducersInfo {
    producers: Producer[];
    nextProducers: Producer[];
    consensus: ConsensusData;
    nextConsensus: ConsensusData | null;
    jointStart: number | null;
    mode: "CFT" | "BFT" | "unknown";
    nextMode: "CFT" | "BFT" | null;
}

const consensusMode = (c: ConsensusData | null | undefined) =>
    c?.cft ? "CFT" : c?.bft ? "BFT" : null;

export const fetchProducersInfo = async (): Promise<ProducersInfo> => {
    const data = await graphqlAuth<{
        producers: Producer[];
        nextProducers: Producer[];
        consensus: ConsensusData;
        nextConsensus: ConsensusData | null;
        jointStart: number | null;
    }>(
        explorer.producers.graphql,
        `{
            producers { name auth { service rawData } }
            nextProducers { name auth { service rawData } }
            consensus {
                ... on CftConsensus { cft: producers { name } }
                ... on BftConsensus { bft: producers { name } }
            }
            nextConsensus {
                ... on CftConsensus { cft: producers { name } }
                ... on BftConsensus { bft: producers { name } }
            }
            jointStart
        }`,
    );
    return {
        ...data,
        mode: consensusMode(data.consensus) ?? "unknown",
        nextMode: consensusMode(data.nextConsensus),
    };
};

export const fetchCandidates = async (
    names: string[],
): Promise<CandidateInfo[]> => {
    if (names.length === 0) return [];
    const data = await graphqlAuth<{ candidatesInfo: CandidateInfo[] }>(
        explorer.producers.graphql,
        `{ candidatesInfo(names: [${names.map(gqlString).join(",")}]) {
            account endpoint claim { service rawData }
        } }`,
    );
    return data.candidatesInfo;
};

export const fetchAllCandidates = async (): Promise<CandidateInfo[]> => {
    const data = await graphqlAuth<{ allCandidates: Connection<CandidateInfo> }>(
        explorer.producers.graphql,
        `{ allCandidates(first: 200) { edges { node { account endpoint claim { service rawData } } } } }`,
    );
    return data.allCandidates.edges.map((e) => e.node);
};

// ---------------------------------------------------------------------------
// Accounts / auth / code
// ---------------------------------------------------------------------------

export interface AccountInfo {
    accountNum: string;
    authService: string;
    authSequence: string;
}

export const fetchAccount = async (
    name: string,
): Promise<AccountInfo | null> => {
    const account = await callPluginFunction(explorer.accounts.getAccount, [
        name,
    ]);
    if (!account) return null;
    return {
        accountNum: account.accountNum,
        authService: account.authService,
        authSequence: String(account.authSequence),
    };
};

export interface AuthRecord {
    account: string;
    pubkey: string;
}

export const fetchAuthRecord = async (
    name: string,
): Promise<AuthRecord | null> => {
    try {
        const pubkey = await callPluginFunction(
            explorer.accounts.getAuthSigPubkey,
            [name],
        );
        return pubkey === undefined ? null : { account: name, pubkey };
    } catch {
        return null;
    }
};

export interface AuthDelegateRecord {
    account: string;
    owner: string;
}

export const fetchAuthDelegateOwner = async (
    name: string,
): Promise<AuthDelegateRecord | null> => {
    try {
        const owner = await callPluginFunction(
            explorer.accounts.getDelegateOwner,
            [name],
        );
        return owner === undefined ? null : { account: name, owner };
    } catch {
        return null;
    }
};

export interface AuthDynManagement {
    account: string;
    manager: string;
}

export const fetchAuthDynManagement = async (
    name: string,
): Promise<AuthDynManagement | null> => {
    try {
        const manager = await callPluginFunction(
            explorer.accounts.getDynManager,
            [name],
        );
        return manager === undefined ? null : { account: name, manager };
    } catch {
        return null;
    }
};

export interface AuthDynAuthorizer {
    account: string;
    weight: number;
}

export interface AuthDynPolicy {
    threshold: number;
    authorizers: AuthDynAuthorizer[];
}

export const fetchAuthDynPolicy = async (
    name: string,
): Promise<AuthDynPolicy | null> => {
    try {
        return (
            (await callPluginFunction(explorer.accounts.getDynPolicy, [
                name,
            ])) ?? null
        );
    } catch {
        return null;
    }
};

/** Accounts whose auth-sig key is `pubkeyPem`. */
export const fetchAccountsWithKey = (pubkeyPem: string): Promise<string[]> =>
    callPluginFunction(explorer.accounts.getAccountsWithKey, [pubkeyPem]);

export interface CodeRecord {
    codeNum: string;
    flags: string[];
    codeHash: string;
    vmType: number;
    vmVersion: number;
}

export const fetchCode = async (
    account: string,
): Promise<CodeRecord | null> => {
    try {
        const data = await graphqlAuth<{ code: CodeRecord | null }>(
            explorer.setcode.graphql,
            `{ code(account: ${gqlString(account)}) { codeNum flags codeHash vmType vmVersion } }`,
        );
        return data.code;
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

export interface InstalledPackage {
    name: string;
    version: string;
    description: string;
    depends: { name: string; version: string }[];
    accounts: string[];
    services: string[];
    owner: string;
}

export const fetchInstalledPackages = async (): Promise<InstalledPackage[]> => {
    const packages = await callPluginFunction(
        explorer.network.getInstalledPackages,
        [],
    );
    return packages.map(({ meta, owner }) => ({
        name: meta.name,
        version: meta.version,
        description: meta.description,
        depends: meta.depends,
        accounts: meta.accounts,
        services: meta.services,
        owner,
    }));
};

// ---------------------------------------------------------------------------
// Registry (app metadata)
// ---------------------------------------------------------------------------

export interface AppMetadata {
    accountId: string;
    name: string;
    shortDesc: string;
    longDesc: string;
    icon: string;
    iconMimeType: string;
    createdAt: string;
    tags: string[];
    status: string;
}

export const fetchAppMetadata = async (
    account: string,
): Promise<AppMetadata | null> => {
    try {
        const data = await graphqlAuth<{ appMetadata: AppMetadata | null }>(
            explorer.registry.graphql,
            `{ appMetadata(accountId: ${gqlString(account)}) {
                accountId name shortDesc longDesc icon iconMimeType createdAt tags status
            } }`,
        );
        return data.appMetadata;
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export interface SiteConfig {
    account: string;
    spa: boolean;
    cache: boolean;
    globalCsp: string;
}

export const fetchSiteConfig = async (
    account: string,
): Promise<SiteConfig | null> => {
    try {
        const data = await graphqlAuth<{ getConfig: SiteConfig | null }>(
            explorer.sites.graphql,
            `{ getConfig(account: ${gqlString(account)}) { account spa cache globalCsp } }`,
        );
        return data.getConfig;
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------------------
// Chain-wide info
// ---------------------------------------------------------------------------

export interface SnapshotInfo {
    lastSnapshot: string;
    snapshotInterval: number;
}

export const fetchSnapshotInfo = async (): Promise<SnapshotInfo | null> => {
    try {
        const data = await graphqlAuth<{ snapshotInfo: SnapshotInfo | null }>(
            explorer.transact.graphql,
            `{ snapshotInfo { lastSnapshot snapshotInterval } }`,
        );
        return data.snapshotInfo;
    } catch {
        return null;
    }
};

export const fetchNetworkName = async (): Promise<string> => {
    try {
        return await callPluginFunction(explorer.network.getNetworkName, []);
    } catch {
        return "";
    }
};

export const fetchChainId = async (): Promise<string> => {
    try {
        const value = await getJson<string>("/common/chainid");
        return typeof value === "string" ? value : "";
    } catch {
        return "";
    }
};

export const fetchRootDomain = async (): Promise<string> => {
    try {
        const value = await getJson<string>("/common/rootdomain");
        return typeof value === "string" ? value : "";
    } catch {
        return "";
    }
};

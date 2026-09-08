import type {
    BlockHeader,
    BlockRecord,
    Connection,
    ConsensusData,
    Producer,
    TransactionLocation,
} from "./types";

import { getJson } from "@psibase/common-lib";

import { FIRST_VISIBLE_BLOCK } from "./types";
import { gqlString, graphql } from "./graphql";

// ---------------------------------------------------------------------------
// Explorer service (block log)
// ---------------------------------------------------------------------------

/** Fields fetched for list/feed views. Deliberately omits action payloads. */
const BLOCK_SUMMARY_FIELDS = `
    id
    header {
        previous
        blockNum
        time
        producer
        term
        commitNum
    }
    transactions {
        id
        transaction {
            tapos { expiration refBlockSuffix flags refBlockIndex }
            actions { sender service method }
            claims { service }
        }
    }
`;

/** Full block including action payloads, merkle roots, and consensus changes. */
const BLOCK_FULL_FIELDS = `
    id
    header {
        previous
        blockNum
        time
        producer
        term
        commitNum
        consensusState
        trxMerkleRoot
        eventMerkleRoot
        newConsensus {
            data {
                ... on CftConsensus { cft: producers { name auth { service rawData } } }
                ... on BftConsensus { bft: producers { name auth { service rawData } } }
            }
            services { codeNum codeHash vmType vmVersion }
            wasmConfig {
                numExecutionMemories
                vmOptions {
                    max_mutable_global_bytes
                    max_pages
                    max_table_elements
                    max_stack_bytes
                }
            }
        }
    }
    transactions {
        id
        transaction {
            tapos { expiration refBlockSuffix flags refBlockIndex }
            actions { sender service method rawData }
            claims { service rawData }
        }
        proofs
    }
`;

export interface BlockRangeArgs {
    gt?: number;
    ge?: number;
    lt?: number;
    le?: number;
    first?: number;
    last?: number;
    before?: string;
    after?: string;
}

const rangeArgs = (args: BlockRangeArgs) => {
    // Never fetch the genesis block.
    const merged: BlockRangeArgs = { ...args };
    if (merged.ge === undefined && merged.gt === undefined) {
        merged.ge = FIRST_VISIBLE_BLOCK;
    } else if (merged.ge !== undefined && merged.ge < FIRST_VISIBLE_BLOCK) {
        merged.ge = FIRST_VISIBLE_BLOCK;
    } else if (merged.gt !== undefined && merged.gt < FIRST_VISIBLE_BLOCK - 1) {
        merged.gt = FIRST_VISIBLE_BLOCK - 1;
    }
    return Object.entries(merged)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) =>
            typeof v === "string" ? `${k}: ${gqlString(v)}` : `${k}: ${v}`,
        )
        .join(", ");
};

export const fetchBlocks = async (
    args: BlockRangeArgs,
    signal?: AbortSignal,
): Promise<Connection<BlockRecord>> => {
    const data = await graphql<{ blocks: Connection<BlockRecord> }>(
        `{ blocks(${rangeArgs(args)}) {
            pageInfo { hasPreviousPage hasNextPage startCursor endCursor }
            edges { cursor node { ${BLOCK_SUMMARY_FIELDS} } }
        } }`,
        undefined,
        signal,
    );
    return data.blocks;
};

export const fetchBlock = async (
    blockNum: number,
): Promise<BlockRecord | null> => {
    if (blockNum < FIRST_VISIBLE_BLOCK) return null;
    const data = await graphql<{ block: BlockRecord | null }>(
        `{ block(blockNum: ${blockNum}) { ${BLOCK_FULL_FIELDS} } }`,
    );
    return data.block;
};

export const fetchBlockSummary = async (
    blockNum: number,
): Promise<BlockRecord | null> => {
    if (blockNum < FIRST_VISIBLE_BLOCK) return null;
    const data = await graphql<{ block: BlockRecord | null }>(
        `{ block(blockNum: ${blockNum}) { ${BLOCK_SUMMARY_FIELDS} } }`,
    );
    return data.block;
};

export const fetchBlockHeader = async (
    blockNum: number,
): Promise<BlockHeader | null> => {
    if (blockNum < FIRST_VISIBLE_BLOCK) return null;
    const data = await graphql<{ blockHeader: BlockHeader | null }>(
        `{ blockHeader(blockNum: ${blockNum}) { previous blockNum time producer term commitNum } }`,
    );
    return data.blockHeader;
};

export const fetchHead = async (
    signal?: AbortSignal,
): Promise<BlockHeader | null> => {
    const data = await graphql<{ head: BlockHeader | null }>(
        `{ head { previous blockNum time producer term commitNum } }`,
        undefined,
        signal,
    );
    return data.head;
};

export const findTransaction = async (
    id: string,
    maxBlocks = 20000,
): Promise<TransactionLocation | null> => {
    const data = await graphql<{ transaction: TransactionLocation | null }>(
        `{ transaction(id: ${gqlString(id)}, maxBlocks: ${maxBlocks}) {
            blockNum blockId blockTime producer index
            transaction {
                id
                transaction {
                    tapos { expiration refBlockSuffix flags refBlockIndex }
                    actions { sender service method rawData }
                    claims { service rawData }
                }
                proofs
            }
        } }`,
    );
    return data.transaction;
};

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
    const data = await graphql<{
        producers: Producer[];
        nextProducers: Producer[];
        consensus: ConsensusData;
        nextConsensus: ConsensusData | null;
        jointStart: number | null;
    }>(
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
        "producers",
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
    const data = await graphql<{ candidatesInfo: CandidateInfo[] }>(
        `{ candidatesInfo(names: [${names.map(gqlString).join(",")}]) {
            account endpoint claim { service rawData }
        } }`,
        "producers",
    );
    return data.candidatesInfo;
};

export const fetchAllCandidates = async (): Promise<CandidateInfo[]> => {
    const data = await graphql<{ allCandidates: Connection<CandidateInfo> }>(
        `{ allCandidates(first: 200) { edges { node { account endpoint claim { service rawData } } } } }`,
        "producers",
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
    const data = await graphql<{ getAccount: AccountInfo | null }>(
        `{ getAccount(accountName: ${gqlString(name)}) { accountNum authService authSequence } }`,
        "accounts",
    );
    return data.getAccount;
};

export interface AuthRecord {
    account: string;
    pubkey: string;
}

export const fetchAuthRecord = async (
    name: string,
): Promise<AuthRecord | null> => {
    try {
        const data = await graphql<{ account: AuthRecord | null }>(
            `{ account(name: ${gqlString(name)}) { account pubkey } }`,
            "auth-sig",
        );
        return data.account;
    } catch {
        return null;
    }
};

export const fetchAccountsWithKey = async (
    pubkeyPem: string,
): Promise<AuthRecord[]> => {
    const data = await graphql<{ accWithKey: Connection<AuthRecord> }>(
        `{ accWithKey(pubkeyPem: ${gqlString(pubkeyPem)}, first: 50) {
            edges { node { account pubkey } }
        } }`,
        "auth-sig",
    );
    return data.accWithKey.edges.map((e) => e.node);
};

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
        const data = await graphql<{ code: CodeRecord | null }>(
            `{ code(account: ${gqlString(account)}) { codeNum flags codeHash vmType vmVersion } }`,
            "setcode",
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
    const result: InstalledPackage[] = [];
    let after: string | undefined;
    for (let i = 0; i < 20; i++) {
        const data = await graphql<{ installed: Connection<InstalledPackage> }>(
            `{ installed(first: 100${after ? `, after: ${gqlString(after)}` : ""}) {
                pageInfo { hasNextPage endCursor }
                edges { node { name version description depends { name version } accounts services owner } }
            } }`,
            "packages",
        );
        result.push(...data.installed.edges.map((e) => e.node));
        if (!data.installed.pageInfo.hasNextPage) break;
        after = data.installed.pageInfo.endCursor;
    }
    return result;
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
        const data = await graphql<{ appMetadata: AppMetadata | null }>(
            `{ appMetadata(accountId: ${gqlString(account)}) {
                accountId name shortDesc longDesc icon iconMimeType createdAt tags status
            } }`,
            "registry",
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
        const data = await graphql<{ getConfig: SiteConfig | null }>(
            `{ getConfig(account: ${gqlString(account)}) { account spa cache globalCsp } }`,
            "sites",
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
        const data = await graphql<{ snapshotInfo: SnapshotInfo | null }>(
            `{ snapshotInfo { lastSnapshot snapshotInterval } }`,
            "transact",
        );
        return data.snapshotInfo;
    } catch {
        return null;
    }
};

export const fetchNetworkName = async (): Promise<string> => {
    try {
        const data = await graphql<{ networkName: string }>(
            `{ networkName }`,
            "branding",
        );
        return data.networkName;
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

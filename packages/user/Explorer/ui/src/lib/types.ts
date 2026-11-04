export interface Claim {
    service: string;
    rawData: string;
}

export interface Action {
    sender: string;
    service: string;
    method: string;
    /** Hex-encoded fracpack arguments. */
    rawData?: string;
    /** Schema-decoded arguments when a service schema is available. */
    data?: unknown;
}

export interface Transaction {
    actions: Action[];
}

export interface TransactionRecord {
    id: string;
    /** Number of top-level actions. Public, even when `transaction` is redacted. */
    numActions: number;
    /** `null` when the viewer is not a party to the transaction. */
    transaction: Transaction | null;
    proofs?: string[] | null;
}

/** Top-level actions received by a service within one block. */
export interface ServiceActionCount {
    service: string;
    count: number;
}

export interface Producer {
    name: string;
    auth?: Claim;
}

export interface ConsensusData {
    cft?: Producer[];
    bft?: Producer[];
}

export interface BlockHeaderAuthAccount {
    codeNum: string;
    codeHash: string;
    vmType: number;
    vmVersion: number;
}

export interface Consensus {
    data: ConsensusData;
    services: BlockHeaderAuthAccount[];
    wasmConfig: {
        numExecutionMemories: number;
        vmOptions: {
            max_mutable_global_bytes: number;
            max_pages: number;
            max_table_elements: number;
            max_stack_bytes: number;
        };
    };
}

export interface BlockHeader {
    previous: string;
    blockNum: number;
    time: string;
    producer: string;
    term: number;
    commitNum: number;
    consensusState?: string;
    trxMerkleRoot?: string;
    eventMerkleRoot?: string;
    newConsensus?: Consensus | null;
}

export interface BlockRecord {
    id: string;
    header: BlockHeader;
    /** `null` when the block's transactions couldn't be queried, e.g. because they're too large. */
    transactions: TransactionRecord[] | null;
    actionsReceived: ServiceActionCount[];
}

export interface PageInfo {
    hasPreviousPage: boolean;
    hasNextPage: boolean;
    startCursor: string;
    endCursor: string;
}

export interface Connection<T> {
    edges: { node: T; cursor: string }[];
    pageInfo: PageInfo;
}

export interface TransactionLocation {
    blockNum: number;
    blockId: string;
    blockTime: string;
    producer: string;
    index: number;
    transaction: TransactionRecord;
}

/** A transaction flattened together with the block context it lives in. */
export interface TransactionWithContext {
    id: string;
    blockNum: number;
    blockId: string;
    blockTime: string;
    producer: string;
    index: number;
    numActions: number;
    /** `null` when the viewer is not a party to the transaction. */
    transaction: Transaction | null;
    isSystem: boolean;
}

/** psibase numbers the genesis block 2; there is no block 1. */
export const GENESIS_BLOCK = 2;

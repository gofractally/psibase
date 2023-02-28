declare module "*.svg" {
    const content: FC<SVGProps<SVGSVGElement>>;
    export default content;
}

declare module "common/keyConversions.mjs" {
    const KeyType = {
        k1: 0,
        r1: 1,
    };

    const publicKeyDataSize: number;
    const privateKeyDataSize: number;
    const signatureDataSize: number;

    const base58Chars: string;

    function create_base58_map(): string;

    function base58ToBinary(size: number, s: string): Uint8Array;

    function binaryToBase58(bignum: Uint8Array): string;

    function digestSuffixRipemd160(data: string, suffix: string);

    function stringToKey(s: string, size: number, suffix: string): Uint8Array;

    function keyToString(data: any, suffix: string, prefix: string): string;

    let k1;
    function getK1(): any;

    let r1;
    function getR1(): any;

    // Convert a private key in string form to {keyType, keyPair}
    function privateStringToKeyPair(s: string): any;

    // Convert a public key in string form to {keyType, keyPair}
    function publicStringToKeyPair(s: string): any;

    // Convert the private key in {keyType, keyPair} to a string
    function privateKeyPairToString({ keyType, keyPair }: any): string;

    // Convert the public key in {keyType, keyPair} to a string
    function publicKeyPairToString({ keyType, keyPair }: any): string;

    // Convert the public key in {keyType, keyPair} to fracpack format
    function publicKeyPairToFracpack({ keyType, keyPair }: any): Uint8Array;

    // Convert the signature in {keyType, signature} to fracpack format
    function signatureToFracpack({ keyType, signature }: any): Uint8Array;

    function keyPairStrings(key: any): any;

    function genKeyPair(keyType: any): any;
}

declare module "common/rpc.mjs" {
    function getRootDomain(): Promise<string>;

    function siblingUrl(
        baseUrl?: string | null,
        service?: string,
        path?: string
    ): Promise<string>;

    function initializeApplet(fn?: (data: any) => Promise<void>): void;

    function getJson<T = any>(url: string): Promise<T>;
    function postJson<T = any>(url: string, json: any): Promise<T>;

    const MessageTypes = {
        Action: "Action",
        Query: "Query",
        Operation: "Operation",
        QueryResponse: "QueryResponse",
        OperationResponse: "OperationResponse",
        TransactionReceipt: "TransactionReceipt",
        SetActiveAccount: "SetActiveAccount",
    };

    declare class AppletId {
        constructor(appletName: string, subPath?: string);

        name: string;
        subPath: string;
        fullPath: string;

        equals: (appletId: AppletId) => boolean;
        url: () => Promise<string>;
        static fromFullPath: (fullPath: string) => AppletId;
        static fromObject: (obj: string) => AppletId;
    }

    declare class Service {
        protected cachedApplet?: string;

        applet(): Promise<string>;
        getAppletName(): Promise<string>;
        getAppletId(): Promise<AppletId>;

        public get operations(): Operation[];
        public get queries(): Operation[];
    }

    function Action(target: any, key: string, descriptor: any): void;
    function Op(
        name?: string
    ): (target: any, key: string, descriptor: any) => void;
    function Qry(
        name?: string
    ): (target: any, key: string, descriptor: any) => void;

    function getCurrentApplet(): Promise<string>;

    function query<Params, Response>(
        appletId: AppletId,
        queryName: string,
        params?: Params
    ): Promise<Response>;

    function action<ActionParams>(
        application: string,
        actionName: string,
        params: ActionParams,
        sender?: string
    ): void;

    function setActiveAccount(account: string): void;

    type Operation = { id: string; exec: (params: any) => Promise<void> };

    type CallbackResponse = {
        sender: AppletId;
        response: any;
        errors: any;
    };

    function storeCallback(
        callback: (res: CallbackResponse) => unknown
    ): number;

    function executeCallback(
        callbackId: any,
        response: CallbackResponse
    ): boolean;

    function getTaposForHeadBlock(baseUrl?: string): Promise<any>;

    function packAndPushSignedTransaction(
        baseUrl: any,
        signedTransaction: any
    ): Promise<any>;

    function setOperations(operations: Operation[]): void;
    function setQueries(queries: Query[]): void;
    function operation<Params>(
        appletId: AppletId,
        name: string,
        params?: Params
    ): Promise<any>;
    function signTransaction(
        baseUrl: string,
        transaction: any,
        privateKeys?: string[] // TODO: remove optional once we're done with fake-auth
    ): Promise<any>;
    function verifyFields(obj: any, fieldNames: any): boolean;

    function postGraphQLGetJson<GqlResponse>(
        url: string,
        query: string
    ): Promise<GqlResponse>;

    function uint8ArrayToHex(data: Uint8Array): string;

    // TODO: remove and use the proper rpc.d.ts
    type Claim = {
        service: string;
        rawData: string; // hex bytes
    };

    type WrappedClaim = {
        claim: Claim;
        pubkey: string; // Public key string
    };
}

declare module "common/rpc.mjs" {
    function getRootDomain(): Promise<string>;

    function siblingUrl(
        baseUrl?: string | null,
        service?: string,
        path?: string
    ): Promise<string>;

    function initializeApplet(fn: (data: any) => Promise<void>): void;

    function getJson<T = any>(url: string): Promise<T>;
    function getArrayBuffer(url: string): Promise<ArrayBuffer>;
    function postJson<T = any>(url: string, json: any): Promise<T>;
    function postArrayBuffer<T = any>(url: string, arrayBuffer: ArrayBuffer): Promise<T>;
    function postArrayBufferGetJson<T = any>(url: string, arrayBuffer: ArrayBuffer): Promise<T>;



    const MessageTypes = {
        Action: "Action",
        Query: "Query",
        Operation: "Operation",
        QueryResponse: "QueryResponse",
        OperationResponse: "OperationResponse",
        TransactionReceipt: "TransactionReceipt",
        SetActiveAccount: "SetActiveAccount",
        ChangeHistory: "ChangeHistory",
    };

    type ChangeHistoryPayload = {
        pathname: string;
        search: string;
        hash: string;
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
    function packAndDigestTransaction(
        baseUrl: string,
        transaction: any
    ): Promise<any>;
    function verifyFields(obj: any, fieldNames: any): boolean;

    function postGraphQLGetJson<GqlResponse>(
        url: string,
        query: string
    ): Promise<GqlResponse>;

    function uint8ArrayToHex(data: Uint8Array): string;

    interface GetClaimParams {
        service: string;
        sender: string;
        method: string;
        params: any;
    }

    type Claim = {
        service: string;
        rawData: string; // hex bytes
    };

    type WrappedClaim = {
        claim: Claim;
        pubkey: string; // Public key string
    };

    type MessageMetadata = {
        sender: string;
    }
}

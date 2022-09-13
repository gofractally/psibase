declare module "common/rpc.mjs" {
  function getRootDomain(): Promise<string>;

  function siblingUrl(
    baseUrl?: string | null,
    service?: string,
    path?: string
  ): Promise<string>;

  function initializeApplet(fn: (data: any) => Promise<void>): void;

  function getJson<T = any>(url: string): Promise<T>;

  const MessageTypes = {
    Action: "Action",
    Query: "Query",
    Operation: "Operation",
    QueryResponse: "QueryResponse",
    OperationResponse: "OperationResponse",
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

  type Operation = { id: string; exec: (params: any) => Promise<void> };

  function storeCallback(callback: any): number;

  function executeCallback(callbackId: any, response: any): boolean;

  function getTaposForHeadBlock(baseUrl?: string): Promise<any>;


  interface SignedTransaction { transaction: string; proofs: any[] }

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
  ): Promise<SignedTransaction>;
  function verifyFields(obj: any, fieldNames: any): boolean;

  function postGraphQLGetJson<GqlResponse>(
    url: string,
    query: string
  ): Promise<GqlResponse>;

  function uint8ArrayToHex(data: Uint8Array): string;
}

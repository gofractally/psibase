


declare module "common/rpc.mjs" {

    type Operation = { id: string; exec: (params: any) => Promise<void>; };

    function getCurrentApplet(): Promise<string>;
    function initializeApplet(fn: (data: any) => Promise<void>): void;
    function getJson(url: string): Promise<any>;
    function query<Params, Response>(
        applet: string,
        subPath: string,
        queryName: string,
        params: Params,
        callback: (res: Response) => void
    ): void;

    function action<ActionParams>(
        application: string,
        actionName: string,
        params: ActionParams,
        sender?: string
    ): void;
    function siblingUrl(
        baseUrl?: string,
        contract: string,
        path: string
    ): Promise<string>;
    function setOperations(operations: Operation[]): void;
    function operation<Params>(
        applet: string,
        subPath: string,
        name: string,
        params: Params
    ): void;
}

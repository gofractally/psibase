



declare module "common/rpc.mjs" {
    function operation(contract: string, dunno1: string, name: string, params: any): void;
    function getJson(url: string): Promise<any>;

    function initializeApplet(fun: () => void): void;
    function siblingUrl(dunno1: any, contract: string, endpoint: string): Promise<string>;

    function action(contract: string, dunno1: string, dunno2: any): void;
    function query(account: string, dunno1: string, dunno2: string, dunno3: any, callback: (data: any) => void): void;
    function setOperations(derp: any[]): Promise<any>
}

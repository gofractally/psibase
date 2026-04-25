import {
    QualifiedDynCallArgs,
    QualifiedFunctionCallArgs,
    QualifiedResourceCallArgs,
} from "@psibase/common-lib";

export interface HttpRequest {
    uri: string;
    method: string;
    headers: { key: string; value: string }[];
    body?: BodyType;
}

export interface HttpResponse {
    status: number;
    headers: { key: string; value: string }[];
    body: BodyType | null;
}

export interface BodyType {
    tag: string;
    val: Uint8Array | string;
}

export interface PluginPostDetails {
    endpoint: string;
    headers: [string, string][];
    body: BodyType;
}

/// Imports exposed to privileged plugins
export interface BridgeImports {
    "supervisor:bridge/intf": {
        sendRequest: (
            req: HttpRequest,
            withCredentials?: boolean,
        ) => HttpResponse;
        serviceStack: () => string[];
        getRootDomain: () => string;
        getChainId: () => string;
        sign: (msg: Uint8Array, publicKey: string) => Uint8Array;
        signExplicit: (msg: Uint8Array, privateKey: string) => Uint8Array;
        importKey: (privateKey: string) => string;
        importKeyTransient: (privateKey: string) => string;
    };
    "supervisor:bridge/database": {
        get: (duration: number, key: string) => Uint8Array | null;
        set: (duration: number, key: string, value: Uint8Array) => void;
        remove: (duration: number, key: string) => void;
    };
    "supervisor:bridge/prompt": {
        requestPrompt: () => void;
    };
}

// This is the interface linked to the host plugin
export interface HostInterface {
    bridge: BridgeImports;

    // Proxy entry points used by buildInterfaceProxy. Not exposed to plugins
    //   directly; reachable only through closures the proxy installs.
    syncCall: (args: QualifiedFunctionCallArgs) => any;
    syncCallResource: (args: QualifiedResourceCallArgs) => any;
    syncCallDyn: (args: QualifiedDynCallArgs) => any;
}

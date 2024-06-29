import { siblingUrl } from "@psibase/common-lib/rpc";
import {
    QualifiedFunctionCallArgs,
    QualifiedPluginId,
} from "@psibase/common-lib/messaging";
import { buildPluginCallResponse } from "@psibase/supervisor-lib";

export class DownloadFailed extends Error {
    url: string;
    constructor(url: string) {
        super("");
        this.name = "DownloadFailed";
        this.url = url;
    }
}

export class PluginDownloadFailed extends Error {
    pluginId: QualifiedPluginId;
    constructor(pluginId: QualifiedPluginId) {
        super("");
        this.name = "PluginDownloadFailed";
        this.pluginId = pluginId;
    }
}
export class ParserDownloadFailed extends Error {
    constructor() {
        super("");
        this.name = "ParserDownloadFailed";
    }
}
export class ParsingFailed extends Error {
    constructor(message: any) {
        super(message);
        this.name = "ParsingFailed";
    }
}

export class InvalidPlugin extends Error {
    constructor(message: any) {
        super(message);
        this.name = "InvalidPlugin";
    }
}

interface ComponentError extends Error {
    payload: object;
}

interface CommonPluginId {
    plugin: string;
    service: string;
}
interface CommonError {
    code: number;
    message: string;
    producer: CommonPluginId;
}

function isCommonPluginId(pluginId: any): pluginId is CommonPluginId {
    return (
        typeof pluginId === "object" &&
        "plugin" in pluginId &&
        typeof pluginId.plugin === "string" &&
        "service" in pluginId &&
        typeof pluginId.service === "string"
    );
}

function isCommonError(error: any): error is CommonError {
    return (
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "number" &&
        "message" in error &&
        typeof error.message === "string" &&
        "producer" in error &&
        typeof error.producer === "object" &&
        isCommonPluginId(error.producer)
    );
}

export const isSyncCall = (e: any): e is Error => {
    return (
        e instanceof Error &&
        typeof e.message === "string" &&
        e.message.includes("synchronous_call")
    );
};

export const isAddingAction = (e: any): e is Error => {
    return (
        e instanceof Error &&
        typeof e.message === "string" &&
        e.message.includes("adding_action")
    );
};

const isDeserializationError = (e: any) => {
    return (
        e instanceof Error &&
        typeof e.message === "string" &&
        e.message.includes("Cannot destructure property")
    );
};

const isParseError = (e: any) => {
    return (
        e !== null &&
        typeof e === "object" &&
        "code" in e &&
        typeof e.code === "string" &&
        e.code === "PARSE_ERROR"
    );
};

function isComponentError(e: any): e is ComponentError {
    return e instanceof Error && 
           'payload' in e && 
           typeof (e as ComponentError).payload === "object" &&
           isCommonError((e as ComponentError).payload);
}

interface PluginError {
    errorType: string,
    args: QualifiedFunctionCallArgs,
    val: Error | CommonError,
};

const err = (payload: PluginError) => {
    window.parent.postMessage(
        buildPluginCallResponse(payload, []),
        siblingUrl(null, "supervisor"),
    );
};

export const handleErrors = (args: QualifiedFunctionCallArgs, e: any) => {
    if (isDeserializationError(e)) {
        err({
            errorType: "unrecoverable",
            args,
            val: {
                name: "DeserializationError",
                message: `Possible error with plugin import code generation`,
            },
        });
    } else if (isComponentError(e)) {
        // This happens when a plugin returns an error
        //  as opposed to trapping. The returned error is considered 
        //  "recoverable" in the sense that it can be passed back to 
        //  and handled within the caller.
        err({
            errorType: "recoverable",
            args,
            val: e.payload as CommonError,
        });
    } else if (e instanceof Error && e.message === "unreachable") {
        e.message = `Runtime error (panic)`;
        err({
            errorType: "unrecoverable",
            args,
            val: e,
        });
    } else if (isParseError(e)) {
        err({
            errorType: "unrecoverable",
            args,
            val: {
                name: "ParseError",
                message: `Possible plugin import code gen error`,
            },
        });
    } else if (e instanceof PluginDownloadFailed) {
        let { service, plugin } = e.pluginId;
        err({
            errorType: "unrecoverable",
            args,
            val: {
                name: "PluginDownloadFailed",
                message: `Failed to download ${service}:${plugin}.`,
            },
        });
    } else if (e instanceof ParserDownloadFailed) {
        err({
            errorType: "unrecoverable",
            args,
            val: {
                name: "ParserDownloadFailed",
                message: `Failed to download parser. Possible network issues.`,
            },
        });
    } else if (e instanceof ParsingFailed) {
        err({
            errorType: "unrecoverable",
            args,
            val: {
                name: "ComponentParsingFailed",
                message: `Parsing plugin failed. Possible invalid wit syntax.`,
            },
        });
    } else if (e instanceof InvalidPlugin) {
        err({
            errorType: "unrecoverable",
            args,
            val: {
                name: "InvalidPlugin",
                message: `${e.message}`,
            },
        });
    } else {
        // Unrecognized error
        if (e instanceof Error) {
            err({
                errorType: "unrecoverable",
                args,
                val: {
                    name: e.name,
                    message: `${e.message}`,
                },
            });
        } else {
            err({
                errorType: "unrecoverable",
                args,
                val: {
                    name: "unknown",
                    message: `${JSON.stringify(e, null, 2)}`,
                },
            });
        }
    }
};

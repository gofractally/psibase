import { siblingUrl } from "@psibase/common-lib";
import {
    QualifiedFunctionCallArgs,
    QualifiedPluginId,
    buildPluginCallResponse,
    toString,
} from "@psibase/common-lib/messaging";

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

const reply = (payload: any) => {
    window.parent.postMessage(
        buildPluginCallResponse(payload, []),
        siblingUrl(null, "supervisor-sys"),
    );
};

export const handleErrors = (args: QualifiedFunctionCallArgs, e: any) => {
    if (isDeserializationError(e)) {
        reply({
            errorType: "unrecoverable",
            val: {
                message: `${toString(args)}: Possible plugin import code gen error.`,
            },
        });
    } else if (
        e instanceof Error &&
        typeof (e as ComponentError).payload === "object" &&
        isCommonError((e as ComponentError).payload)
    ) {
        reply({
            errorType: "recoverable",
            val: (e as ComponentError).payload,
        });
    } else if (e instanceof Error && e.message === "unreachable") {
        reply({
            errorType: "unrecoverable",
            val: { message: `${toString(args)}: Runtime error (panic)` },
        });
    } else if (isParseError(e)) {
        reply({
            errorType: "unrecoverable",
            val: {
                message: `${toString(args)}: Possible plugin import code gen error`,
            },
        });
    } else if (e instanceof PluginDownloadFailed) {
        let { service, plugin } = e.pluginId;
        reply({
            errorType: "unrecoverable",
            val: {
                message: `${toString(args)}: Failed to download ${service}:${plugin}.`,
            },
        });
    } else if (e instanceof ParserDownloadFailed) {
        reply({
            errorType: "unrecoverable",
            val: {
                message: `${toString(args)}: Failed to download parser. Possible network issues.`,
            },
        });
    } else if (e instanceof ParsingFailed) {
        reply({
            errorType: "unrecoverable",
            val: {
                message: `${toString(args)}: Parsing plugin failed. Possible invalid wit syntax.`,
            },
        });
    } else if (e instanceof InvalidPlugin) {
        reply({
            errorType: "unrecoverable",
            val: {
                message: `${toString(args)}: [InvalidPlugin] ${e.message}`,
            },
        });
    } else {
        // Unrecognized error
        if (e instanceof Error) {
            reply({
                errorType: "unrecoverable",
                val: {
                    error: e.name,
                    message: `${toString(args)}: ${e.message}`,
                },
            });
        } else {
            reply({
                errorType: "unrecoverable",
                val: {
                    error: "unknown",
                    message: `${toString(args)}: ${JSON.stringify(e, null, 2)}`,
                },
            });
        }
    }
};

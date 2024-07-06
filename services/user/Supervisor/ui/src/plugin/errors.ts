import {
    QualifiedFunctionCallArgs,
    QualifiedPluginId,
    isQualifiedFunctionCallArgs,
} from "@psibase/common-lib";

export interface PluginError {
    errorType: string;
    args: QualifiedFunctionCallArgs;
    val: Error;
}

const isError = (obj: any): obj is Error => {
    return (
        typeof obj?.name === "string" &&
        typeof obj?.message === "string" &&
        (typeof obj?.stack === "string" || typeof obj?.stack === "undefined")
    );
};

export const isPluginError = (obj: any): obj is PluginError => {
    return (
        typeof obj === "object" &&
        "errorType" in obj &&
        "args" in obj &&
        "val" in obj &&
        typeof obj.errorType === "string" &&
        isQualifiedFunctionCallArgs(obj.args) &&
        isError(obj.val)
    );
};

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

export class PluginInvalid extends Error {
    pluginId: QualifiedPluginId;
    constructor(id: QualifiedPluginId) {
        super("");
        this.name = "PluginInvalid";
        this.pluginId = id;
        this.message = `${id.service}:${id.plugin} is either invalid or was called before ready.`;
    }
}

export class InvalidCall extends Error {
    pluginId: QualifiedPluginId;
    constructor(id: QualifiedPluginId, intf: string | undefined, method: string) {
        super("");
        this.name = "InvalidCall";
        this.pluginId = id;
        this.message = `${id.service}:${id.plugin} does not export ${intf ? `${intf}:${method}` : method }`;
    }
}

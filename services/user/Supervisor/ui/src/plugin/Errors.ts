import {
    QualifiedFunctionCallArgs,
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

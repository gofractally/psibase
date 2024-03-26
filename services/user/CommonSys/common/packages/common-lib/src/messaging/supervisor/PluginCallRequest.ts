import { QualifiedFunctionCallArgs } from "./FunctionCallRequest";
import { ResultCache } from "./CallContext";

const PLUGIN_CALL_REQUEST = "PLUGIN_CALL_REQUEST" as const;

export interface FunctionCallResult<T = any> extends QualifiedFunctionCallArgs {
    result: T;
}

export interface PluginCallPayload {
    caller: string;
    args: QualifiedFunctionCallArgs;
    resultCache: ResultCache[];
}

export interface PluginCallRequest {
    type: typeof PLUGIN_CALL_REQUEST;
    payload: PluginCallPayload;
}

export const isPluginCallRequest = (data: any): data is PluginCallRequest => {
    const isEventTypeSatisfied = data && data.type == PLUGIN_CALL_REQUEST;
    if (!isEventTypeSatisfied) return false;
    const { args } = data.payload;
    const isSchemaSatisfied =
        typeof args == "object" &&
        "service" in args &&
        "plugin" in args &&
        "method" in args;
    if (!isSchemaSatisfied)
        throw new Error(
            `PluginCallRequest fails to meet schema. Received: ${JSON.stringify(
                data
            )}`
        );
    return isEventTypeSatisfied && isSchemaSatisfied;
};

export const buildPluginCallRequest = (
    payload: PluginCallPayload
): PluginCallRequest => ({
    type: PLUGIN_CALL_REQUEST,
    payload
});

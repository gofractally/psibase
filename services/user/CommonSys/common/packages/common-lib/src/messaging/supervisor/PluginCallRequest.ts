import { QualifiedFunctionCallArgs } from "./FunctionCallRequest";

const PLUGIN_CALL_REQUEST = "PLUGIN_CALL_REQUEST" as const;

export interface FunctionCallResult<T = any> extends QualifiedFunctionCallArgs {
    id: string;
    result: T;
}

export interface PluginCallPayload {
    id: string;
    args: QualifiedFunctionCallArgs;
    precomputedResults: FunctionCallResult[];
}

export interface PluginCallRequest {
    type: typeof PLUGIN_CALL_REQUEST;
    payload: PluginCallPayload;
}

export const isPluginCallRequest = (data: any): data is PluginCallRequest => {
    const isEventTypeSatisfied = data && data.type == PLUGIN_CALL_REQUEST;
    if (!isEventTypeSatisfied) return false;
    const { id, args } = data.payload;
    const isSchemaSatisfied =
        typeof id == "string" &&
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
    payload,
});

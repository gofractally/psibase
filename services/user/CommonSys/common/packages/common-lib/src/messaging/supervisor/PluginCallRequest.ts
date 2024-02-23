import { FunctionCallArgs } from "./FunctionCallRequest";

const PLUGIN_CALL_REQUEST = "PLUGIN_CALL_REQUEST" as const;

export interface FunctionCallResult<T = any> extends FunctionCallArgs {
    id: string;
    result: T;
}

export interface PluginCallPayload {
    id: string;
    args: FunctionCallArgs;
    precomputedResults: FunctionCallResult[];
}

export interface PluginCallRequest {
    type: typeof PLUGIN_CALL_REQUEST;
    payload: PluginCallPayload;
}

export const isPluginCallRequest = (data: any): data is PluginCallRequest =>
    data &&
    data.type == PLUGIN_CALL_REQUEST &&
    typeof data.payload.id == "string";

export const buildPluginCallRequest = (
    payload: PluginCallPayload
): PluginCallRequest => ({
    type: PLUGIN_CALL_REQUEST,
    payload,
});

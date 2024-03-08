import { FunctionCallArgs } from "./FunctionCallRequest";
import { PLUGIN_CALL_FAILURE } from "./index";

interface PluginCallFailureArgs extends FunctionCallArgs {
    id: string;
}

export interface PluginCallFailure {
    type: typeof PLUGIN_CALL_FAILURE;
    payload: PluginCallFailureArgs;
}

export const isPluginCallFailure = (data: any): data is PluginCallFailure =>
    data && data.type == PLUGIN_CALL_FAILURE;

export const buildPluginCallFailure = (
    payload: PluginCallFailureArgs
): PluginCallFailure => ({
    payload,
    type: PLUGIN_CALL_FAILURE
});

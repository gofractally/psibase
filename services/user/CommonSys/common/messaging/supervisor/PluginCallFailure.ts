import { FunctionCallArgs } from "./FunctionCallRequest";
import { PLUGIN_CALL_FAILURE, buildEvent } from "./index";

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
): PluginCallFailure =>
    buildEvent<typeof PLUGIN_CALL_FAILURE, PluginCallFailureArgs>(
        PLUGIN_CALL_FAILURE,
        payload
    );

import { QualifiedFunctionCallArgs } from "./FunctionCallRequest";
import { SYNC_CALL_REQUEST } from "./index";

export interface PluginSyncCall {
    type: typeof SYNC_CALL_REQUEST;
    payload: QualifiedFunctionCallArgs;
}

export const isPluginSyncCall = (data: any): data is PluginSyncCall =>
    data && data.type == SYNC_CALL_REQUEST;

export const buildPluginSyncCall = (
    payload: QualifiedFunctionCallArgs,
): PluginSyncCall => ({
    payload,
    type: SYNC_CALL_REQUEST,
});

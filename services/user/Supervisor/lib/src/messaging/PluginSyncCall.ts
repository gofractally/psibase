import { QualifiedFunctionCallArgs } from "@psibase/common-lib";
import { SYNC_CALL_REQUEST } from "./index";

export interface PluginSyncCall {
    type: typeof SYNC_CALL_REQUEST;
    args: QualifiedFunctionCallArgs;
}

export const isPluginSyncCall = (data: any): data is PluginSyncCall =>
    data && data.type == SYNC_CALL_REQUEST;

export const buildPluginSyncCall = (
    args: QualifiedFunctionCallArgs,
): PluginSyncCall => ({
    args,
    type: SYNC_CALL_REQUEST,
});

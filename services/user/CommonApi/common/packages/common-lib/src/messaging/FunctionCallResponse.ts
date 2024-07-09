import { FUNCTION_CALL_RESPONSE, QualifiedPluginId } from "./index";
import { FunctionCallArgs } from "./index";

export interface FunctionCallResponse {
    type: typeof FUNCTION_CALL_RESPONSE;
    call: FunctionCallArgs;
    result: any;
}

export const isFunctionCallResponse = (
    data: any,
): data is FunctionCallResponse => {
    return data && data.type == FUNCTION_CALL_RESPONSE;
};

export class PluginError extends Error {
    pluginId: QualifiedPluginId;
    constructor(pluginId: QualifiedPluginId, message: string) {
        super("");
        this.name = "PluginError";
        this.pluginId = pluginId;
        this.message = message;
    }
}

export const isGenericError = (error: any): error is Error => {
    return typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string' &&
        'name' in error && 
        typeof error.name === 'string';
};

export const isPluginError = (error: any): error is PluginError => {
    return isGenericError(error) &&
        'pluginId' in error;
};

export const buildFunctionCallResponse = (
    call: FunctionCallArgs,
    result: any,
): FunctionCallResponse => {
    return {
        type: FUNCTION_CALL_RESPONSE,
        call,
        result,
    };
};

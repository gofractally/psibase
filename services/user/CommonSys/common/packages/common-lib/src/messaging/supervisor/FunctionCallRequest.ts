import { FUNCTION_CALL_REQUEST } from "./index";

export interface FunctionCallArgs {
    service: string;
    plugin?: string;
    intf?: string;
    method: string;
    params: any[];
}

export interface QualifiedFunctionCallArgs extends FunctionCallArgs {
    plugin: string;
}

export interface FunctionCallRequest {
    type: typeof FUNCTION_CALL_REQUEST;
    payload: {
        id: string;
        args: QualifiedFunctionCallArgs;
    };
}

export const isFunctionCallRequest = (data: any): data is FunctionCallRequest =>
    data && data.type == FUNCTION_CALL_REQUEST;

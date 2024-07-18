import { FUNCTION_CALL_RESPONSE } from "./index";
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

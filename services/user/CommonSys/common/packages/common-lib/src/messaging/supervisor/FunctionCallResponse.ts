import { FUNCTION_CALL_RESPONSE } from "./index";
import { FunctionCallArgs } from "./index";

export interface FunctionCallResponse {
    type: typeof FUNCTION_CALL_RESPONSE;
    call: FunctionCallArgs,
    result: any;
}

export const isFunctionCallResponse = (
    data: any
): data is FunctionCallResponse => {
    return data && data.type == FUNCTION_CALL_RESPONSE;
};

export const isErrorResult = (result : any) => {
    return (
        typeof result === "object" &&
        "errorType" in result &&
        typeof result.errorType === "string" &&
        "val" in result &&
        typeof result.val === "object"
    );
}

export const isErrorResponse = (response : FunctionCallResponse) => {
    return isErrorResult(response.result);
}

export const buildFunctionCallResponse = (
    call: FunctionCallArgs,
    result: any
): FunctionCallResponse => {
    return {
        type: FUNCTION_CALL_RESPONSE,
        call,
        result,
    };
};

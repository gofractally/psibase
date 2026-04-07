import { FUNCTION_CALL_RESPONSE } from "./index";

export interface FunctionCallResponse {
    type: typeof FUNCTION_CALL_RESPONSE;
    id: string;
    result: any;
}

export const isFunctionCallResponse = (
    data: any,
): data is FunctionCallResponse => {
    return data && data.type == FUNCTION_CALL_RESPONSE;
};

export const buildFunctionCallResponse = (
    id: string,
    result: any,
): FunctionCallResponse => {
    return {
        type: FUNCTION_CALL_RESPONSE,
        id,
        result,
    };
};

import type { UUID } from "crypto";

import { FUNCTION_CALL_RESPONSE } from "./index";
import { FunctionCallArgs } from "./index";

export interface FunctionCallResponse {
    type: typeof FUNCTION_CALL_RESPONSE;
    id: UUID;
    call: FunctionCallArgs;
    result: any;
}

export const isFunctionCallResponse = (
    data: any,
): data is FunctionCallResponse => {
    return data && data.type == FUNCTION_CALL_RESPONSE;
};

export const buildFunctionCallResponse = (
    id: UUID,
    call: FunctionCallArgs,
    result: any,
): FunctionCallResponse => {
    return {
        type: FUNCTION_CALL_RESPONSE,
        id,
        call,
        result,
    };
};

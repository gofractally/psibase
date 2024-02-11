import { FUNCTION_CALL_RESPONSE, Message } from ".";

export interface FunctionCallResponse extends Message {
    type: typeof FUNCTION_CALL_RESPONSE;
    payload: {
        id: string;
        result: any;
    };
}

export const isFunctionCallResponse = (
    data: any
): data is FunctionCallResponse => {
    // TODO add further assertions on expectations in the payload.
    return data && data.type == FUNCTION_CALL_RESPONSE;
};

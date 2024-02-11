export const I_FRAME_INITIALIZED = "I_FRAME_INITIALIZED" as const;
export const FUNCTION_CALL_REQUEST = "FUNCTION_CALL_REQUEST" as const;
export const FUNCTION_CALL_RESPONSE = "FUNCTION_CALL_RESPONSE" as const;

type MessageType =
    | typeof I_FRAME_INITIALIZED
    | typeof FUNCTION_CALL_RESPONSE
    | typeof FUNCTION_CALL_REQUEST;

export interface Message<T = any> {
    type: MessageType;
    payload: T;
}

export { type FunctionCallResponse } from "./FunctionCallResponse";
export {
    type FunctionCallRequest,
    type FunctionCallArgs,
} from "./FunctionCallRequest";
export { isIFrameIntialized } from "./IFrameIntialized";
export { isFunctionCallResponse } from "./FunctionCallResponse";

export const I_FRAME_INITIALIZED = "I_FRAME_INITIALIZED" as const;
export const FUNCTION_CALL_REQUEST = "FUNCTION_CALL_REQUEST" as const;
export const FUNCTION_CALL_RESPONSE = "FUNCTION_CALL_RESPONSE" as const;
export const PLUGIN_CALL_FAILURE = "PLUGIN_CALL_FAILURE" as const;

export interface Message<T = string, P = any> {
    type: T;
    payload: P;
}

export { type FunctionCallResponse } from "./FunctionCallResponse";
export {
    type FunctionCallRequest,
    type FunctionCallArgs,
    type QualifiedFunctionCallArgs
} from "./FunctionCallRequest";
export { isIFrameInitialized } from "./SupervisorInitialized";
export { isFunctionCallResponse } from "./FunctionCallResponse";
export { buildMessageLoaderInitialized as buildMessageIFrameInitialized } from "./LoaderInitialized";

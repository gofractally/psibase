export const buildEvent = <Y, T>(
    type: Y,
    payload: T
): { type: Y; payload: T } => ({
    type,
    payload,
});

export const I_FRAME_INITIALIZED = "I_FRAME_INITIALIZED" as const;
export const FUNCTION_CALL_REQUEST = "FUNCTION_CALL_REQUEST" as const;
export const FUNCTION_CALL_RESPONSE = "FUNCTION_CALL_RESPONSE" as const;
export const PLUGIN_CALL_FAILURE = "PLUGIN_CALL_FAILURE" as const;

type MessageType =
    | typeof I_FRAME_INITIALIZED
    | typeof FUNCTION_CALL_RESPONSE
    | typeof FUNCTION_CALL_REQUEST
    | typeof PLUGIN_CALL_FAILURE;

export interface Message<T = any> {
    type: MessageType;
    payload: T;
}

export { type FunctionCallResponse } from "./FunctionCallResponse";
export {
    type FunctionCallRequest,
    type FunctionCallArgs,
} from "./FunctionCallRequest";
export { isIFrameInitialized } from "./SupervisorInitialized";
export { isFunctionCallResponse } from "./FunctionCallResponse";
export { buildMessageLoaderInitialized as buildMessageIFrameInitialized } from "./LoaderInitialized";

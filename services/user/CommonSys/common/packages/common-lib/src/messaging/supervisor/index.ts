export const I_FRAME_INITIALIZED = "I_FRAME_INITIALIZED" as const;
export const FUNCTION_CALL_REQUEST = "FUNCTION_CALL_REQUEST" as const;
export const FUNCTION_CALL_RESPONSE = "FUNCTION_CALL_RESPONSE" as const;
export const SYNC_CALL_REQUEST = "SYNC_CALL_REQUEST" as const;
export const LOADER_INITIALIZED = "LOADER_INITIALIZED" as const;
export const LOADER_PRELOAD_START = "LOADER_PRELOAD_START" as const;
export const LOADER_PRELOAD_COMPLETE = "LOADER_PRELOAD_COMPLETE" as const;

export { type FunctionCallResponse } from "./FunctionCallResponse";
export {
    type FunctionCallRequest,
    type FunctionCallArgs,
    type QualifiedFunctionCallArgs,
    toString
} from "./FunctionCallRequest";

export { isIFrameInitialized } from "./SupervisorInitialized";
export { isFunctionCallResponse } from "./FunctionCallResponse";
export { buildMessageLoaderInitialized as buildMessageIFrameInitialized } from "./LoaderInitialized";

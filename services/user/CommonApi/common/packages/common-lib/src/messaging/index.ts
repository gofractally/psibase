export const I_FRAME_INITIALIZED = "I_FRAME_INITIALIZED" as const;
export const FUNCTION_CALL_REQUEST = "FUNCTION_CALL_REQUEST" as const;
export const FUNCTION_CALL_RESPONSE = "FUNCTION_CALL_RESPONSE" as const;

export {
    type FunctionCallResponse,
    buildFunctionCallResponse,
    isFunctionCallResponse,
} from "./FunctionCallResponse";

export {
    type FunctionCallRequest,
    isFunctionCallRequest,
    type FunctionCallArgs,
    type QualifiedFunctionCallArgs,
    isQualifiedFunctionCallArgs,
    toString,
} from "./FunctionCallRequest";

export {
    type PreLoadPluginsRequest,
    isPreLoadPluginsRequest,
} from "./PreLoadPluginsRequest";

export { type PluginId, type QualifiedPluginId } from "./PluginId";
export {
    isSupervisorInitialized,
    buildMessageSupervisorInitialized,
} from "./SupervisorInitialized";

export {
    PluginError,
    isPluginError,
    isGenericError,
} from "./Errors";

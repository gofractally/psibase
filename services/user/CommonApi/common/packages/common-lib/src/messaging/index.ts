export const I_FRAME_INITIALIZED = "I_FRAME_INITIALIZED" as const;
export const FUNCTION_CALL_REQUEST = "FUNCTION_CALL_REQUEST" as const;
export const FUNCTION_CALL_RESPONSE = "FUNCTION_CALL_RESPONSE" as const;
export const GET_JSON_REQUEST = "GET_JSON_REQUEST" as const;

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
    buildFunctionCallRequest,
    toString,
    getCallArgs,
} from "./FunctionCallRequest";

export {
    type PreLoadPluginsRequest,
    isPreLoadPluginsRequest,
} from "./PreLoadPluginsRequest";

export {
    type PluginId,
    type QualifiedPluginId,
    isEqual,
    pluginId,
    pluginString,
} from "./PluginId";

export {
    isSupervisorInitialized,
    buildMessageSupervisorInitialized,
} from "./SupervisorInitialized";

export {
    type GetJsonRequest,
    isGetJsonRequest,
    buildGetJsonRequest,
} from "./GetJsonRequest";

export { PluginError, PluginErrorObject, RedirectErrorObject, GenericErrorObject, isPluginError, isGenericError, isPluginErrorObject, isRedirectErrorObject, isGenericErrorObject } from "./Errors";

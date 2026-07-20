export const I_FRAME_INITIALIZED = "I_FRAME_INITIALIZED" as const;
export const FUNCTION_CALL_REQUEST = "FUNCTION_CALL_REQUEST" as const;
export const FUNCTION_CALL_RESPONSE = "FUNCTION_CALL_RESPONSE" as const;
export const GET_JSON_REQUEST = "GET_JSON_REQUEST" as const;

export {
    type FunctionCallResponse,
    buildFunctionCallResponse,
    isFunctionCallResponse,
} from "./function-call-response";

export {
    type FunctionCallRequest,
    isFunctionCallRequest,
    type FunctionCallArgs,
    type QualifiedFunctionCallArgs,
    isQualifiedFunctionCallArgs,
    buildFunctionCallRequest,
    toString,
    getCallArgs,
} from "./function-call-request";

export {
    type ResourceCallArgs,
    type QualifiedResourceCallArgs,
    toQualifiedFunctionCallArgs,
    getResourceCallArgs,
} from "./resource-function-call-request";

export { type QualifiedDynCallArgs } from "./dynamic-function-call-request";

export {
    type PreLoadPluginsRequest,
    isPreLoadPluginsRequest,
} from "./preload-plugins-request";

export {
    type PluginId,
    type QualifiedPluginId,
    isEqual,
    pluginId,
    pluginString,
} from "./plugin-id";

export {
    isSupervisorInitialized,
    buildMessageSupervisorInitialized,
} from "./supervisor-initialized";

export {
    type GetJsonRequest,
    isGetJsonRequest,
    buildGetJsonRequest,
} from "./get-json-request";

export {
    PluginError,
    PluginErrorObject,
    RedirectErrorObject,
    GenericError,
    GenericErrorObject,
    isPluginError,
    isGenericError,
    isPluginErrorObject,
    isRedirectErrorObject,
    isGenericErrorObject,
} from "./errors";

import {
    FunctionCallRequest,
    PreLoadPluginsRequest,
} from "@psibase/common-lib";

// This is the part of the supervisor interface exposed to front-end apps
export interface AppInterface {
    preloadPlugins: (
        callerOrigin: string,
        request: PreLoadPluginsRequest,
    ) => void;

    call: (callerOrigin: string, request: FunctionCallRequest) => void;
}

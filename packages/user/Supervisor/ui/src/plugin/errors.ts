import { PluginError, QualifiedPluginId } from "@psibase/common-lib";

export class PluginDownloadFailed extends PluginError {
    constructor(pluginId: QualifiedPluginId) {
        super(pluginId, "Plugin download failed.");
    }
}

export class PluginInvalid extends PluginError {
    constructor(pluginId: QualifiedPluginId) {
        super(pluginId, "Plugin either invalid or called before ready.");
    }
}

export class InvalidUrl extends Error {
    constructor(url: string) {
        super(`Invalid Url: ${url}`);
    }
}

export class InvalidCall extends PluginError {
    constructor(
        pluginId: QualifiedPluginId,
        intf: string | undefined,
        method: string,
    ) {
        super(
            pluginId,
            `Unrecognized call: ${intf ? `${intf}:${method}` : method}`,
        );
    }
}

export interface RecoverableErrorPayload {
    code: number;
    message: string;
    producer: QualifiedPluginId;
}

// A recoverable error should be passed to prior plugins in the callstack, as they
// may choose to handle the error rather than returning an error back to the UI.
export interface RecoverableError {
    name: string;
    message: string;
    payload: RecoverableErrorPayload;
}

/*
  If a recoverable error is returned by a component, the js glue code will wrap it in a 
  thrown ComponentError object. Whereas if a recoverable error is thrown directly by js
  imported into a component, it will in some cases *not* be wrapped in a ComponentError object 
  (depending on the callstack up to the point of the throw).

  In other words, to detect if the error is a recoverable error, and in order to support
  errors thrown by js or returned as the Err variant of a Result object by a wasm component,
  we must check for both the wrapped and unwrapped forms of the error.
*/
export const getRecoverableError = (
    e: any,
): RecoverableErrorPayload | undefined => {
    if (isRecoverableErrorPayload(e)) {
        return e;
    } else if (
        typeof e === "object" &&
        e !== null &&
        "name" in e &&
        typeof e.name === "string" &&
        "message" in e &&
        typeof e.message === "string" &&
        "payload" in e &&
        typeof e.payload === "object" &&
        e.payload !== null &&
        isRecoverableErrorPayload(e.payload)
    ) {
        return e.payload;
    }
    return undefined;
};

export const isRecoverableErrorPayload = (
    payload: any,
): payload is RecoverableErrorPayload => {
    return (
        "code" in payload &&
        typeof payload.code === "number" &&
        "message" in payload &&
        typeof payload.message === "string" &&
        "producer" in payload &&
        typeof payload.producer === "object" &&
        payload.producer !== null &&
        "service" in payload.producer &&
        typeof payload.producer.service === "string" &&
        "plugin" in payload.producer &&
        typeof payload.producer.plugin === "string"
    );
};

import {
    GenericErrorObject,
    PluginError,
    PluginErrorObject,
    QualifiedPluginId,
} from "@psibase/common-lib";

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

function isUselessMessage(message: string): boolean {
    return (
        message.length === 0 ||
        message.includes("[object Object]") ||
        message.includes("(see error.payload)") ||
        /^\{"name":"[A-Za-z]+"\}$/.test(message)
    );
}

export function formatCaughtError(error: unknown, depth = 0): string {
    if (depth > 8 || error == null) {
        return "";
    }
    if (typeof error === "string") {
        const message = error.trim();
        return isUselessMessage(message) ? "" : message;
    }
    if (typeof error === "number" || typeof error === "boolean") {
        return String(error);
    }
    if (Array.isArray(error)) {
        return error
            .map((item) => formatCaughtError(item, depth + 1))
            .filter((item) => item.length > 0)
            .join(": ");
    }
    if (typeof error === "object") {
        const rec = error as Record<string, unknown>;
        if ("payload" in rec && rec.payload !== undefined) {
            const fromPayload = formatCaughtError(rec.payload, depth + 1);
            if (fromPayload) {
                return fromPayload;
            }
        }
        if (typeof rec.tag === "string" && "val" in rec) {
            const inner = formatCaughtError(rec.val, depth + 1);
            return inner ? `${rec.tag}: ${inner}` : rec.tag;
        }
        if (typeof rec.message === "string") {
            const message = rec.message.trim();
            if (!isUselessMessage(message)) {
                return message;
            }
        }
        try {
            const json = JSON.stringify(error);
            if (json && json !== "{}" && !isUselessMessage(json)) {
                return json;
            }
        } catch {
            // fall through
        }
        if (error instanceof Error) {
            const message = (error.message || "").trim();
            return isUselessMessage(message) ? error.name : message;
        }
        return "";
    }
    return String(error);
}

export function toPostableError(
    error: unknown,
): PluginErrorObject | GenericErrorObject {
    if (error instanceof PluginErrorObject) {
        return error;
    }
    if (error instanceof GenericErrorObject) {
        return error;
    }
    const recoverable = getRecoverableError(error);
    if (recoverable) {
        return new PluginErrorObject(recoverable.producer, recoverable.message);
    }
    if (error instanceof PluginError) {
        return new PluginErrorObject(
            error.pluginId,
            error.message || "Unknown plugin error",
        );
    }
    const message = formatCaughtError(error);
    return new GenericErrorObject(message || "Unknown plugin error");
}

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

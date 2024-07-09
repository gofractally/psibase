import {
    PluginError,
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

export class InvalidCall extends PluginError {
    constructor(pluginId: QualifiedPluginId, intf: string | undefined, method: string) {
        super(pluginId, `Unrecognized call: ${intf ? `${intf}:${method}` : method }`);
    }
}

export interface RecoverableErrorPayload {
    code: number,
    message: string,
    producer: QualifiedPluginId,
}

// A recoverable error should be passed to prior plugins in the callstack, as they 
// may choose to handle the error rather than returning an error back to the UI.
export interface RecoverableError {
    name: string;
    message: string;
    payload: RecoverableErrorPayload;
}

export const isRecoverableError = (e: any): e is RecoverableError => {
    return typeof e === 'object' && e !== null &&
        'name' in e && typeof e.name === 'string' &&
        'message' in e && typeof e.message === 'string' &&
        'payload' in e && typeof e.payload === 'object' && e.payload !== null &&
        isRecoverableErrorPayload(e.payload);
};

export const isRecoverableErrorPayload = (payload: any): payload is RecoverableErrorPayload => {
    return 'code' in payload && typeof payload.code === 'number' &&
        'message' in payload && typeof payload.message === 'string' &&
        'producer' in payload && typeof payload.producer === 'object' && payload.producer !== null &&
        'service' in payload.producer && typeof payload.producer.service === 'string' &&
        'plugin' in payload.producer && typeof payload.producer.plugin === 'string';
};
import { PluginError, QualifiedPluginId } from "@psibase/common-lib";
import { z } from "zod";

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

const zRecoverableErrorPayload = z.object({
    code: z.number(),
    message: z.string(),
    producer: z.object({
        service: z.string(),
        plugin: z.string(),
    }),
});

// A recoverable error should be passed to prior plugins in the callstack, as they
// may choose to handle the error rather than returning an error back to the UI.
export type RecoverableError = z.infer<typeof zRecoverableError>;

const zRecoverableError = z.object({
    name: z.string(),
    message: z.string(),
    payload: zRecoverableErrorPayload,
});

export const isRecoverableError = (e: any): e is RecoverableError => zRecoverableError.safeParse(e).success;


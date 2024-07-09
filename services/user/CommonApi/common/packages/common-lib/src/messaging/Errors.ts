import { QualifiedPluginId } from "./PluginId";

// This is an unrecoverable error
export class PluginError extends Error {
    pluginId: QualifiedPluginId;
    constructor(pluginId: QualifiedPluginId, message: string) {
        super("");
        this.name = "PluginError";
        this.pluginId = pluginId;
        this.message = message;
    }
}

export const isGenericError = (error: any): error is Error => {
    return typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string' &&
        'name' in error && 
        typeof error.name === 'string';
};

export const isPluginError = (error: any): error is PluginError => {
    return isGenericError(error) &&
        'pluginId' in error;
};

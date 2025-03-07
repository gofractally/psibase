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

export class PluginErrorObject {
    name: string;
    pluginId: QualifiedPluginId;
    message: string;
    constructor(pluginId: QualifiedPluginId, message: string) {
        this.name = "PluginErrorObject";
        this.pluginId = pluginId;
        this.message = message;
    }
}

// This is the object sent across app boundaries and must not be of type Error
export class RedirectErrorObject {
    name: string;
    pluginId: QualifiedPluginId;
    message: string;
    data: any;
    constructor(pluginId: QualifiedPluginId, message: string, data: any) {
        this.name = "RedirectErrorObject";
        this.pluginId = pluginId;
        this.message = message;
        this.data = data;
    }
}

export class GenericErrorObject {
    name: string;
    message: string;
    constructor(message: string) {
        this.name = "GenericErrorObject";
        this.message = message;
    }
}

export const isGenericError = (error: any): error is Error => {
    return (
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string" &&
        "name" in error &&
        typeof error.name === "string"
    );
};

export const isPluginError = (error: any): error is PluginError => {
    return isGenericError(error) && "pluginId" in error;
};

export const isGenericErrorObject = (error: any): error is GenericErrorObject => {
    return (
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string" &&
        "name" in error &&
        typeof error.name === "string"
    )
};
export const isPluginErrorObject = (error: any): error is PluginErrorObject => {
    return isGenericErrorObject(error) && "pluginId" in error;
}
export const isRedirectErrorObject = (error: any): error is RedirectErrorObject => {
    return isGenericError(error) && "pluginId" in error && "data" in error;
};

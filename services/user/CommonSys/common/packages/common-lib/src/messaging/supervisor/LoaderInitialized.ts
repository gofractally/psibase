import {
    LOADER_INITIALIZED,
    LOADER_PRELOAD_COMPLETE,
    LOADER_PRELOAD_START,
} from "./index";
import { QualifiedPluginId } from "./PluginId";

export interface LoaderInitialized {
    type: typeof LOADER_INITIALIZED;
    payload: {};
}

export const isLoaderInitMessage = (
    message: any,
): message is LoaderInitialized => {
    return message && message.type == LOADER_INITIALIZED;
};

export const buildMessageLoaderInitialized = (): LoaderInitialized => ({
    payload: {},
    type: LOADER_INITIALIZED,
});

export interface LoaderPreloadStart {
    type: typeof LOADER_PRELOAD_START;
    payload: {
        plugins: string[];
    };
}

export const isPreloadStartMessage = (
    message: any,
): message is LoaderPreloadStart => {
    return message && message.type == LOADER_PRELOAD_START;
};

export const buildPreloadStartMessage = (
    plugins: string[],
): LoaderPreloadStart => ({
    payload: {
        plugins,
    },
    type: LOADER_PRELOAD_START,
});
export interface LoaderPreloadComplete {
    type: typeof LOADER_PRELOAD_COMPLETE;
    payload: {
        dependencies: QualifiedPluginId[];
    };
}

export const isPreloadCompleteMessage = (
    message: any,
): message is LoaderPreloadComplete => {
    return message && message.type == LOADER_PRELOAD_COMPLETE;
};

export const buildPreloadCompleteMessage = (
    dependencies: QualifiedPluginId[],
): LoaderPreloadComplete => ({
    payload: {
        dependencies,
    },
    type: LOADER_PRELOAD_COMPLETE,
});

export const LOADER_INITIALIZED = "LOADER_INITIALIZED" as const;

export interface LoaderInitialized {
    type: typeof LOADER_INITIALIZED;
    payload: {};
}

export const isLoaderInitialized = (
    message: any
): message is LoaderInitialized => {
    // TODO add further assertions on expectations in the payload.
    return message && message.type == LOADER_INITIALIZED;
};

export const buildMessageLoaderInitialized = (): LoaderInitialized => ({
    payload: {},
    type: LOADER_INITIALIZED,
});

const PRE_LOAD_PLUGINS_REQUEST = "PRE_LOAD_PLUGINS_REQUEST" as const;

export interface PreLoadPluginsRequest {
    type: typeof PRE_LOAD_PLUGINS_REQUEST;
    payload: {
        services: string[];
    };
}

export const isPreLoadPluginsRequest = (
    data: any
): data is PreLoadPluginsRequest =>
    data && data.type == PRE_LOAD_PLUGINS_REQUEST;

export const buildPreLoadPluginsRequest = (
    services: string[]
): PreLoadPluginsRequest => ({
    type: PRE_LOAD_PLUGINS_REQUEST,
    payload: {
        services,
    },
});

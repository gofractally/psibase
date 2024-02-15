const PRE_LOAD_SERVICES_REQUEST = "PRE_LOAD_SERVICES_REQUEST" as const;

export interface PreLoadServicesRequest {
    type: typeof PRE_LOAD_SERVICES_REQUEST;
    payload: {
        services: string[];
    };
}

export const isPreLoadServicesRequest = (
    data: any
): data is PreLoadServicesRequest =>
    data && data.type == PRE_LOAD_SERVICES_REQUEST;

export const buildPreLoadServicesRequest = (
    services: string[]
): PreLoadServicesRequest => ({
    type: PRE_LOAD_SERVICES_REQUEST,
    payload: {
        services,
    },
});

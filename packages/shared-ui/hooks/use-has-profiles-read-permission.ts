import { profiles, usePluginFunctionQuery } from "@shared/lib/plugins";

type Options = {
    enabled?: boolean;
};

export const useHasProfilesReadPermission = (
    { enabled }: Options = { enabled: true },
) => {
    return usePluginFunctionQuery(profiles.api.hasReadPermission, [], {
        enabled,
    });
};

import { profiles, usePluginFunctionQuery } from "@shared/lib/plugins";

export const useHasProfilesReadPermission = ({
    enabled = true,
}: {
    enabled?: boolean;
}) => {
    return usePluginFunctionQuery(profiles.api.hasReadPermission, [], {
        enabled,
    });
};

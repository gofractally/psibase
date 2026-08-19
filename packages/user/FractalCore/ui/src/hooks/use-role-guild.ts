import { useQuery } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { useFractalAccount } from "./fractals/use-fractal-account";
import { getRoleMap } from "@/lib/graphql/fractals/get-role-map";

export const useRoleGuild = (roleId?: number) => {
    const fractal = useFractalAccount();

    return useQuery({
        queryKey: QueryKey.roleMap(fractal, roleId!),
        queryFn: async () => getRoleMap(fractal!, roleId!),
        enabled: !!(fractal && roleId),
    });
};

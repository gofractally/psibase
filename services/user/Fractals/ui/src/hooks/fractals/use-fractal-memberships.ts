import { queryClient } from "@/queryClient";
import { useQuery } from "@tanstack/react-query";

import {
    FractalMembershipListInstance,
    getFractalMemberships,
    zFractalMembershipListInstance,
} from "@/lib/graphql/fractals/getFractalMemberships";
import QueryKey, { OptionalAccount } from "@/lib/queryKeys";

import { assertUser } from "../use-current-user";

export const useFractalMemberships = (user: OptionalAccount) =>
    useQuery({
        queryKey: QueryKey.fractalMemberships(user),
        enabled: !!user,
        queryFn: async () => getFractalMemberships(user!),
    });

export const cacheAddFractalMembership = (
    newFractals: FractalMembershipListInstance,
) => {
    queryClient.setQueryData(
        QueryKey.fractalMemberships(assertUser()),
        (existingFractals: any) => {
            if (existingFractals) {
                const parsedExistingFractals =
                    zFractalMembershipListInstance.parse(existingFractals);
                const newFractalsList = zFractalMembershipListInstance.parse(newFractals);

                return [...parsedExistingFractals, ...newFractalsList];
            }
        },
    );
};

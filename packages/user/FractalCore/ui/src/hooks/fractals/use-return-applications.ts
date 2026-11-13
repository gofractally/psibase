import { useQuery } from "@tanstack/react-query";

import { getReturnApplications } from "@/lib/graphql/fractals/get-return-applications";
import QueryKey, { OptionalAccount } from "@/lib/query-keys";

export const useReturnApplications = (fractalAccount: OptionalAccount) =>
    useQuery({
        queryKey: QueryKey.returnApplications(fractalAccount),
        enabled: !!fractalAccount,
        queryFn: () => getReturnApplications(fractalAccount!),
    });

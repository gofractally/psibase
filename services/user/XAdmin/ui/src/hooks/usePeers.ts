import { getJson } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";

export const usePeers = () =>
    useQuery({
        queryKey: ["peers"],
        queryFn: () => getJson("/native/admin/peers"),
        refetchInterval: 10000,
    });

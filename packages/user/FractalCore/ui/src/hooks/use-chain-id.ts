import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import QueryKey from "@/lib/queryKeys";

export const useChainId = () =>
    useQuery({
        queryKey: QueryKey.chainId(),
        initialData: "",
        queryFn: async () => {
            const res = await fetch("/common/chainid");
            const json = await res.json();
            return z.string().parse(json);
        },
    });

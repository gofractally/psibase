import { useQuery } from "@tanstack/react-query";

import { chain } from "@/lib/chain-endpoints";

export const usePerformance = () =>
    useQuery({
        queryKey: ["performance"],
        queryFn: () => chain.performance(),
    });

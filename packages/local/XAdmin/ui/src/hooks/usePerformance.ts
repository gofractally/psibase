import { useQuery } from "@tanstack/react-query";

import { chain } from "@/lib/chainEndpoints";

export const usePerformance = () =>
    useQuery({
        queryKey: ["performance"],
        queryFn: () => chain.performance(),
    });

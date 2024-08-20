import { chain } from "@/lib/chainEndpoints";
import { useQuery } from "@tanstack/react-query";

export const usePerformance = () =>
    useQuery({
        queryKey: ["performance"],
        queryFn: () => chain.performance(),
    });

import { useQuery } from "@tanstack/react-query";

import { chain } from "@/lib/chain-endpoints";

import { useStatuses } from "./use-statuses";

export const useTransactStats = () => {
    const { data: status } = useStatuses();
    const needgenesis = Boolean(status?.includes("needgenesis"));

    return useQuery({
        queryKey: ["transactStats"],
        queryFn: () => chain.getTransactStats(),
        refetchInterval: 10000,
        enabled: !needgenesis,
    });
};

import { useQuery } from "@tanstack/react-query";

import { getStreams } from "@/lib/get-streams";
import QueryKey from "@/lib/query-keys";

export const useStreams = () =>
    useQuery({
        queryKey: QueryKey.streams(),
        queryFn: async () => {
            return getStreams();
        },
    });

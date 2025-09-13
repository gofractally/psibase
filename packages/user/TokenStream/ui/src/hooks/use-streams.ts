import { useQuery } from "@tanstack/react-query";

import { getStreams } from "@/lib/getStreams";
import QueryKey from "@/lib/queryKeys";

export const useStreams = () =>
    useQuery({
        queryKey: QueryKey.streams(),
        queryFn: async () => {
            return getStreams();
        },
    });

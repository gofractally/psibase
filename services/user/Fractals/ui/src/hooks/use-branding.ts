import QueryKey from "@/lib/queryKeys";
import { supervisor } from "@/supervisor";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const useBranding = () =>
  useQuery({
    queryKey: QueryKey.branding(),
    queryFn: async () => {
      const res = await supervisor.functionCall({
        service: "branding",
        intf: "queries",
        method: "getNetworkName",
        params: [],
      });
      return z.string().parse(res);
    },
  });

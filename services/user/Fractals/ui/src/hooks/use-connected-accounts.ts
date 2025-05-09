import QueryKey from "@/lib/queryKeys";
import { supervisor } from "@/supervisor";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const useConnectedAccounts = () =>
  useQuery({
    queryKey: QueryKey.connectedAccounts(),
    initialData: [],
    queryFn: async () =>
      z
        .string()
        .array()
        .parse(
          await supervisor.functionCall({
            method: "getConnectedAccounts",
            params: [],
            service: "accounts",
            intf: "activeApp",
          })
        ),
  });

import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";

export const useAppMetadata = (appName: string | undefined | null) =>
  useQuery({
    queryKey: ["appMetadata", appName],
    enabled: !!appName,
    queryFn: async () => {
      const res = await supervisor.functionCall({
        method: "getAppMetadata",
        params: [appName],
        service: "registry",
        intf: "consumer",
      });
      console.log(res, "is the res");
      return res;
    },
  });

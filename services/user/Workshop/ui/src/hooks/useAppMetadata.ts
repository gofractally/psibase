import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { Params } from "./useSetMetadata";
import { z } from "zod";

export const Status = z.enum(["draft", "published", "unpublished"]);

export const MetadataResponse = z.object({
  appMetadata: Params,
  extraMetadata: z.object({
    createdAt: z.string(),
    status: Status,
  }),
});

export const appMetadataQueryKey = (appName: string | undefined | null) => [
  "appMetadata",
  appName,
];

export const useAppMetadata = (appName: string | undefined | null) =>
  useQuery({
    queryKey: appMetadataQueryKey(appName),
    enabled: !!appName,
    queryFn: async () => {
      const res = await supervisor.functionCall({
        method: "getAppMetadata",
        params: [appName],
        service: "registry",
        intf: "consumer",
      });

      return MetadataResponse.parse(res);
    },
  });

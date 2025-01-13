import { supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const Params = z.object({
  name: z.string(),
  shortDescription: z.string(),
  longDescription: z.string(),
  icon: z.string(), // Base64 string
  iconMimeType: z.string(), // MIME type of the icon
  tosSubpage: z.string(),
  privacyPolicySubpage: z.string(),
  appHomepageSubpage: z.string(),
  redirectUris: z.array(z.string()), // List of redirect URIs
  owners: z.array(z.string()), // List of account IDs
  tags: z.array(z.string()), // List of tags
});

export const useSetMetadata = () =>
  useMutation<null, Error, z.infer<typeof Params>>({
    mutationKey: ["setMetdata"],
    mutationFn: async (params) => {
      await supervisor.functionCall({
        method: "setAppMetadata",
        params: [Params.parse(params)],
        service: "registry",
        intf: "developer",
      });

      return null;
    },
  });

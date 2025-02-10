import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

export const Params = z.object({
  name: z.string().max(30),
  shortDescription: z.string().max(100),
  longDescription: z.string().max(1000),
  icon: z.string(), // Base64 string
  iconMimeType: z.string(), // MIME type of the icon
  tosSubpage: z
    .string()
    .refine((val) => val.startsWith("/"), { message: "Must start with /" }),
  privacyPolicySubpage: z
    .string()
    .refine((val) => val.startsWith("/"), { message: "Must start with /" }),
  appHomepageSubpage: z
    .string()
    .refine((val) => val.startsWith("/"), { message: "Must start with /" }),
  redirectUris: z.string().array(),
  owners: z.array(z.string()).default([]),
  tags: z.string().array().max(3),
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

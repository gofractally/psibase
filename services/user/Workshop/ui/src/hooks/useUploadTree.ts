import { Account } from "@/lib/zodTypes";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

// const ByteObjectSchema = z.record(z.coerce.number().int().min(0).max(255));
const u8Schema = z.number().int().min(0).max(255);

const File = z.object({
  path: z.string(),
  contentType: z.string(),
  content: z.any(),
});

const Params = z.object({
  account: Account,
  files: File.array(),
  compressionQuality: u8Schema,
});

export const useUploadTree = () =>
  useMutation<null, Error, z.infer<typeof Params>>({
    mutationKey: ["uploadTree"],
    mutationFn: async (params) => {
      const { account, compressionQuality, files } = Params.parse(params);
      const finalisedParams = [account, files, compressionQuality];

      console.log("Sending", finalisedParams);
      const res = await supervisor.functionCall({
        method: "uploadTree",
        params: finalisedParams,
        service: "workshop",
        intf: "app",
      });

      console.log(res, "came back on upload!!!");

      return null;
    },
  });

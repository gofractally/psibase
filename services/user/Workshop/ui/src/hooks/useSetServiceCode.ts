import { Account } from "@/lib/zodTypes";
import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

// const ByteObjectSchema = z.record(z.coerce.number().int().min(0).max(255));
// const u8Schema = z.number().int().min(0).max(255);

const Params = z.object({
  account: Account,
  code: z.any(),
});

export const useSetServiceCode = () =>
  useMutation<null, Error, z.infer<typeof Params>>({
    mutationKey: ["setServiceCode"],
    mutationFn: async (params) => {
      const { account, code } = Params.parse(params);

      const res = await supervisor.functionCall({
        method: "setServiceCode",
        params: [account, code],
        service: "workshop",
        intf: "app",
      });

      console.log(res, "came back on service code!!!");

      return null;
    },
  });

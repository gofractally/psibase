import { supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

const LoginParams = z.object({
  app: z.string(),
  origin: z.string(),
  accountName: z.string(),
});

export const useLoginDirect = () =>
  useMutation<void, Error, z.infer<typeof LoginParams>>({
    mutationFn: async (params) => {
      const { accountName, app, origin } = LoginParams.parse(params);

      const queryToken = await supervisor.functionCall({
        method: "loginDirect",
        params: [
          {
            app,
            origin,
          },
          accountName,
        ],
        service: "accounts",
        intf: "admin",
      });
      console.log("returned queryToken:", queryToken);
    },
  });

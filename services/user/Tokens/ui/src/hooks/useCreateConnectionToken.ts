import { siblingUrl } from "@psibase/common-lib";
import { z } from "zod";
import { supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { modifyUrlParams } from "@/lib/modifyUrlParams";

export const useCreateConnectionToken = () =>
  useMutation<string, Error>({
    mutationFn: async () =>
      z.string().parse(
        await supervisor.functionCall({
          method: "createConnectionToken",
          params: [],
          service: "accounts",
          intf: "activeApp",
        })
      ),
    onSuccess: (token) => {
      window.location.href = modifyUrlParams(
        siblingUrl(undefined, "accounts"),
        {
          token,
        }
      );
    },
  });

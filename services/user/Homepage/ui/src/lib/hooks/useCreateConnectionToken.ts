import { siblingUrl } from "@psibase/common-lib";
import { modifyUrlParams } from "@/lib/modifyUrlParams";
import { z } from "zod";
import { supervisor } from "@/main";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

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
                siblingUrl(undefined, "accounts", null, false),
                {
                    token,
                }
            );
        },
        onError: (error) => {
            toast.error(error.message);
        },
    });

import { supervisor } from "@/supervisor";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { modifyUrlParams } from "../lib/modifyUrlParams";
import { siblingUrl } from "@psibase/common-lib";

export const useGenerateInvite = () =>
    useMutation({
        mutationFn: async () => {
            const token = z.string().parse(
                await supervisor.functionCall({
                    service: "invite",
                    intf: "inviter",
                    method: "generateInvite",
                    params: [],
                })
            );

            const res = modifyUrlParams(
                siblingUrl(undefined, "accounts", null, false),
                {
                    token,
                }
            );

            return z.string().parse(res);
        },
    });

import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { modifyUrlParams } from "@shared/lib/modify-url-params";
import { supervisor } from "@shared/lib/supervisor";

export const useGenerateInvite = () =>
    useMutation({
        mutationFn: async () => {
            const token = z.string().parse(
                await supervisor.functionCall({
                    service: "invite",
                    intf: "inviter",
                    method: "generateInvite",
                    params: [],
                }),
            );

            const res = modifyUrlParams(siblingUrl(undefined, null, "invite"), {
                token,
            });

            return z.string().parse(res);
        },
    });

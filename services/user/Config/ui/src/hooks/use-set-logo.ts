import { useMutation } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

export const useSetLogo = () =>
    useMutation<void, Error, Uint8Array<ArrayBufferLike>>({
        mutationKey: ["setLogo"],
        mutationFn: async (logoBytes: Uint8Array<ArrayBufferLike>) => {
            await supervisor.functionCall({
                service: "branding",
                intf: "api",
                method: "setLogo",
                params: [logoBytes],
            });
        },
    });

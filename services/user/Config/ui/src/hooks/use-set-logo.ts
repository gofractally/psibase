import { useMutation } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

export const useSetLogo = () =>
    useMutation<void, Error, Uint8Array<ArrayBufferLike>>({
        mutationKey: ["setLogo"],
        mutationFn: async (logoBytes: Uint8Array<ArrayBufferLike>) => {
            console.log(logoBytes, "are the bytes being sent");

            await supervisor.functionCall({
                service: "config",
                intf: "app",
                method: "uploadNetworkLogo",
                params: [logoBytes],
            });
        },
    });

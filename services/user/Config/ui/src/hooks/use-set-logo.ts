import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { supervisor } from "@/supervisor";

export const useSetLogo = () =>
    useMutation<void, Error, Uint8Array<ArrayBufferLike>, string>({
        mutationKey: ["setLogo"],
        onMutate: () => toast.loading("Uploading icon...") as string,
        mutationFn: async (logoBytes: Uint8Array<ArrayBufferLike>) => {
            await supervisor.functionCall({
                service: "config",
                intf: "app",
                method: "uploadNetworkLogo",
                params: [logoBytes],
            });
        },
        onSuccess: (_, __, id) => {
            toast.success("Set icon", { id });
        },
        onError: (error, _, id) => {
            toast.error(error.message, { id });
        },
    });

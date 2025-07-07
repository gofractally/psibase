import { useMutation } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

export const useSetNetworkName = () =>
    useMutation<void, Error, string>({
        mutationKey: ["setNetworkName"],
        mutationFn: async (networkName: string) => {
            await supervisor.functionCall({
                service: "branding",
                intf: "api",
                method: "setNetworkName",
                params: [networkName],
            });
            // TODO: does this return a txid?
        },
    });

import { supervisor } from "@shared/lib/supervisor";
import { useMutation } from "@tanstack/react-query"


export const useConnectAccount = () => {
    return useMutation({
        mutationFn: async (guildAccount: string) => {
            await supervisor.functionCall(
                {
                    service: "accounts",
                    intf: "activeApp",
                    method: "connectAccount",
                    params: [],
                },
                {
                    enabled: true,
                    returnPath: `/guild/${guildAccount}/invite-response`,
                },
            );
        }
    })
}
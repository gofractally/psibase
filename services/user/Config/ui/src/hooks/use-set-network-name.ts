import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { supervisor } from "@/supervisor";

import { getActorHistory } from "@/lib/getActorHistory";
import QueryKey from "@/lib/queryKeys";

import { getCurrentUser } from "./useCurrentUser";

export const useSetNetworkName = () => {
    const navigate = useNavigate();

    return useMutation<void, Error, string>({
        mutationKey: ["setNetworkName"],
        mutationFn: async (networkName: string) => {
            const id = toast.loading("Setting network name...");

            await supervisor.functionCall({
                service: "config",
                intf: "app",
                method: "setNetworkName",
                params: [networkName],
            });

            const currentUser = getCurrentUser()!;

            const actorHistory = await getActorHistory(currentUser);
            const latestId = actorHistory.sort(
                (a, b) =>
                    new Date(b.datetime).valueOf() -
                    new Date(a.datetime).valueOf(),
            )[0].txid;

            const isExecuted = actorHistory.some(
                (item) => item.eventType == "executed" && item.txid == latestId,
            );
            if (isExecuted) {
                toast.success(`Network name saved.`, { id });
                queryClient.setQueryData(QueryKey.branding(), networkName);
            } else {
                toast.success(`Transaction staged`, {
                    id,
                    action: {
                        label: "View staged tx",
                        onClick: () => {
                            navigate(`/pending-transactions/${latestId}`);
                        },
                    },
                });
            }
        },
    });
};

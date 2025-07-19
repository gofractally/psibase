import { queryClient } from "@/queryClient";
import { useMutation } from "@tanstack/react-query";
import { Hourglass } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { supervisor } from "@/supervisor";

import { checkStaging } from "@/lib/checkStaging";
import QueryKey from "@/lib/queryKeys";

export const useSetNetworkName = () => {
    const navigate = useNavigate();

    return useMutation<void, Error, string, string>({
        mutationKey: ["setNetworkName"],
        onMutate: () => toast.loading("Setting network name...") as string,
        mutationFn: async (networkName: string) => {
            await supervisor.functionCall({
                service: "config",
                intf: "app",
                method: "setNetworkName",
                params: [networkName],
            });
        },
        onSuccess: async (_, networkName, id) => {
            const { txId, type } = await checkStaging();
            if (type == "executed") {
                toast.success(`Set network name to ${networkName}.`, { id });
                queryClient.setQueryData(QueryKey.branding(), networkName);
            } else {
                toast.success(`Name change proposed.`, {
                    id,
                    icon: <Hourglass className="h-5 w-5" />,
                    description: "Proposal is awaiting approval.",
                    action: {
                        label: "View",
                        onClick: () => {
                            navigate(`/pending-transactions/${txId}`);
                        },
                    },
                });
            }
        },
        onError: (error, _, id) => {
            console.error("useSetworkName:", error);
            toast.error("Failed setting network name", {
                description: error.message,
                id,
            });
        },
    });
};

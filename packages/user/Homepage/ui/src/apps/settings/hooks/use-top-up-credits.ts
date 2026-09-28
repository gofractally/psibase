import { useMutation } from "@tanstack/react-query";

import QueryKey from "@/lib/query-keys";

import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

export const useTopUpCredits = () => {
    return useMutation<void, Error, void>({
        mutationKey: ["topUpCredits"],
        mutationFn: async () => {
            await supervisor.functionCall({
                service: "vserver",
                plugin: "plugin",
                intf: "billing",
                method: "fillGasTank",
                params: [],
            });
        },
        onSuccess: (_, _variables, _id, context) => {
            toast.success("Usage credits topped up");
            context.client.invalidateQueries({
                queryKey: QueryKey.userResources(),
            });
        },
        onError: (error) => {
            toast.error(error.message || "Couldn't top up usage credits");
        },
    });
};

export const useResizeAndTopUpCredits = () => {
    return useMutation<void, Error, string>({
        mutationKey: ["resizeAndTopUpCredits"],
        mutationFn: async (newCapacity: string) => {
            await supervisor.functionCall({
                service: "vserver",
                plugin: "plugin",
                intf: "billing",
                method: "resizeAndFillGasTank",
                params: [newCapacity],
            });
        },
        onSuccess: (_, _variables, _id, context) => {
            toast.success("Reserve resized and topped up");
            context.client.invalidateQueries({
                queryKey: QueryKey.userResources(),
            });
        },
        onError: (error) => {
            toast.error(error.message || "Couldn't resize your reserve");
        },
    });
};

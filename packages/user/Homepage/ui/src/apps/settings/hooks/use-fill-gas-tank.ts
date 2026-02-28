import { useMutation } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import { toast } from "@shared/shadcn/ui/sonner";
import QueryKey from "@/lib/queryKeys";

export const useFillGasTank = () => {
    return useMutation<void, Error, void>({
        mutationKey: ["fillGasTank"],
        mutationFn: async () => {
            await supervisor.functionCall({
                service: "virtual-server",
                plugin: "plugin",
                intf: "billing",
                method: "fillGasTank",
                params: [],
            });
        },
        onSuccess: (_, _variables, _id, context) => {
            toast.success("Gas tank refilled");
            context.client.invalidateQueries({
                queryKey: QueryKey.userResources(),
            });
        },
        onError: (error) => {
            toast.error(error.message || "Failed to refill gas tank");
        },
    });
};

export const useResizeAndFillGasTank = () => {
    return useMutation<void, Error, string>({
        mutationKey: ["resizeAndFillGasTank"],
        mutationFn: async (newCapacity: string) => {
            await supervisor.functionCall({
                service: "virtual-server",
                plugin: "plugin",
                intf: "billing",
                method: "resizeAndFillGasTank",
                params: [newCapacity],
            });
        },
        onSuccess: (_, _variables, _id, context) => {
            toast.success("Gas tank resized and refilled");
            context.client.invalidateQueries({
                queryKey: QueryKey.userResources(),
            });
        },
        onError: (error) => {
            toast.error(error.message || "Failed to resize and refill gas tank");
        },
    });
};

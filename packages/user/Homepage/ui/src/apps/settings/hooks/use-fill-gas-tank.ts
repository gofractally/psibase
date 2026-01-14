import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supervisor } from "@/supervisor";

import { toast } from "@shared/shadcn/ui/sonner";

export const useFillGasTank = () => {
    const queryClient = useQueryClient();

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
        onSuccess: () => {
            toast.success("Gas tank refilled");
            // Invalidate user resources query to refresh the data
            queryClient.invalidateQueries({
                queryKey: ["userResources"],
            });
        },
        onError: (error) => {
            toast.error(error.message || "Failed to refill gas tank");
        },
    });
};

export const useResizeAndFillGasTank = () => {
    const queryClient = useQueryClient();

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
        onSuccess: () => {
            toast.success("Gas tank resized and refilled");
            // Invalidate user resources query to refresh the data
            queryClient.invalidateQueries({
                queryKey: ["userResources"],
            });
        },
        onError: (error) => {
            toast.error(error.message || "Failed to resize and refill gas tank");
        },
    });
};

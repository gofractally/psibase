import { supervisor } from "@/supervisor";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

export const useSetProfile = () =>
    useMutation({
        mutationFn: async (displayName: string) =>
            supervisor.functionCall({
                method: "setProfile",
                params: [displayName],
                service: "profiles",
                intf: "api",
            }),
        onSuccess: () => {
            toast.success("Profile set");
        },
        onError: () => {
            toast.error("Failed to set profile");
        },
    });

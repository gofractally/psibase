import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";

export const useSupervisor = () =>
    useQuery({
        queryKey: ["loaded"],
        queryFn: async () => {
            await supervisor.onLoaded();
            supervisor.preLoadPlugins([{ service: "accounts" }]);
            return true;
        },
    });

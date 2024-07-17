import {
    PsinodeConfig,
    PsinodeConfigUpdate,
} from "../configuration/interfaces";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../main";
import { queryKeys } from "@/lib/queryKeys";
import { chain } from "@/lib/chainEndpoints";

export const useConfig = () =>
    useQuery<PsinodeConfig, string>({
        queryKey: queryKeys.config,
        queryFn: async (): Promise<PsinodeConfig> => {
            try {
                const res = await chain.getConfig();

                return {
                    ...res,
                    admin: res.admin ? res.admin : undefined,
                    listen: res.listen.map((listen) => ({
                        ...listen,
                        key:
                            listen.protocol +
                            listen.address +
                            listen.path +
                            listen.port,
                    })),
                    services: res.services.map((service, index) => ({
                        ...service,
                        key: service.host + service.root + index.toString(),
                    })),
                };
            } catch (e) {
                const message = `Failed to fetch config`;
                console.error("message", e);
                throw message;
            }
        },
        refetchInterval: 10000,
    });

export const useConfigUpdate = () =>
    useMutation<void, string, PsinodeConfigUpdate>({
        mutationKey: queryKeys.configUpdate,
        mutationFn: async (input) => {
            try {
                return await chain.updateConfig(input);
            } catch (e) {
                console.error(e);
                throw "Error updating config";
            }
        },
        onSuccess: () => {
            const queryKey = queryKeys.config;
            queryClient.invalidateQueries({ queryKey });
            queryClient.refetchQueries({ queryKey });
        },
    });

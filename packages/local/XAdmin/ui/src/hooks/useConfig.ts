import { useMutation, useQuery } from "@tanstack/react-query";

import { chain } from "@/lib/chainEndpoints";
import { queryKeys } from "@/lib/queryKeys";

import {
    PsinodeConfigSelect,
    PsinodeConfigUI,
    PsinodeConfigUpdate,
} from "../configuration/interfaces";
import { queryClient } from "../main";

const transformConfigServerToUI = (
    serverConfig: PsinodeConfigSelect,
): PsinodeConfigUI => {
    return {
        ...serverConfig,
        listen: serverConfig.listen.map((listen) => ({
            ...listen,
            key: listen.protocol + listen.address + listen.path + listen.port,
        })),
        hosts: serverConfig.hosts.map((host, index) => ({
            host,
            key: host + index.toString(),
        })),
        services: serverConfig.services.map((service, index) => ({
            ...service,
            key: service.host + service.root + index.toString(),
        })),
    };
};

export const useConfig = () =>
    useQuery<PsinodeConfigUI, string>({
        queryKey: queryKeys.config,
        queryFn: async (): Promise<PsinodeConfigUI> => {
            try {
                return transformConfigServerToUI(await chain.getConfig());
            } catch (e) {
                console.error(e);
                const message = `Failed to fetch config`;
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
                return await chain.extendConfig(input);
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

import { useMutation, useQuery } from "@tanstack/react-query";

import { chain } from "@/lib/chain-endpoints";
import { queryKeys } from "@/lib/query-keys";

import {
    PsinodeConfigSelect,
    PsinodeConfigUI,
    PsinodeConfigUpdate,
} from "../configuration/interfaces";

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
        onSuccess: (_data, _variables, _onMutateResult, context) => {
            const queryKey = queryKeys.config;
            context.client.invalidateQueries({ queryKey });
            context.client.refetchQueries({ queryKey });
        },
    });

import { putJson } from "../helpers";
import {
    PsinodeConfig,
    PsinodeConfigSchemaa,
    psinodeConfigSchema,
} from "../configuration/interfaces";
import { getJson } from "@psibase/common-lib";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "../main";
import { queryKeys } from "@/lib/queryKeys";

export const useConfig = () =>
    useQuery<PsinodeConfig, string>({
        queryKey: queryKeys.config,
        queryFn: async (): Promise<PsinodeConfig> => {
            try {
                const res = psinodeConfigSchema.parse(
                    await getJson("/native/admin/config")
                );

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
    useMutation<void, string, PsinodeConfigSchemaa>({
        mutationKey: queryKeys.configUpdate,
        mutationFn: async (input) => {
            try {
                const result = await putJson("/native/admin/config", input);
                if (!result.ok) throw await result.text();
            } catch (e) {
                throw "Error updating config";
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.config });
            queryClient.refetchQueries({ queryKey: queryKeys.config });
        },
    });

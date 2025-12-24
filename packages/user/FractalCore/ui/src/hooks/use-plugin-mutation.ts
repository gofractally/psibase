import { useMutation } from "@tanstack/react-query";
import z from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { TxStatus, checkLastTx } from "@/lib/checkStaging";
import { PluginCall } from "@/lib/plugin";

import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

type Meta<TParams extends unknown[]> = {
    error?: string;
    loading?: string;
    success?: string;
} & (
    | {
          isStagable?: false | undefined;
          onSuccess?: (params: TParams) => void | Promise<void>;
      }
    | {
          isStagable: true;
          onSuccess?: (
              params: TParams,
              status: TxStatus,
          ) => void | Promise<void>;
      }
);

export const usePluginMutation = <TCall extends PluginCall>(
    call: TCall,
    meta: Meta<TCall extends PluginCall<infer P> ? P : never>,
) => {
    const { intf, method, service } = call;
    const {
        error = "Failed",
        loading = "Loading",
        success = "Success",
        isStagable = true,
        onSuccess,
    } = meta;

    return useMutation<
        void,
        Error,
        TCall extends PluginCall<infer P> ? P : never,
        string | number
    >({
        mutationKey: [service, intf, method],
        onMutate: () => {
            return toast.loading(loading);
        },
        mutationFn: async (params) => {
            return supervisor.functionCall({
                service,
                intf,
                method,
                params: z.any().array().parse(params),
            });
        },
        onError: (errorObj, _params, toastId) => {
            console.error({ service, intf, method, error: errorObj });
            toast.error(error, {
                description: errorObj.message,
                id: toastId,
            });
        },
        onSuccess: async (_data, params, toastId) => {
            if (isStagable) {
                const lastTx = await checkLastTx();

                if (onSuccess) {
                    await onSuccess(params, lastTx);
                }

                if (lastTx.type === "executed") {
                    toast.success(success, {
                        id: toastId,
                        description: "Change is live.",
                    });
                } else {
                    toast.success(success, {
                        id: toastId,
                        description: "Change is proposed.",
                        action: {
                            label: "View",
                            onClick: () => {
                                window.open(
                                    siblingUrl(
                                        null,
                                        "config",
                                        `/pending-transactions/${lastTx.stagedId}`,
                                    ),
                                    "_blank",
                                );
                            },
                        },
                    });
                }
            } else {
                if (onSuccess) {
                    await (
                        onSuccess as (params: unknown) => Promise<void> | void
                    )(params);
                }
                toast.success(success, { id: toastId });
            }
        },
    });
};

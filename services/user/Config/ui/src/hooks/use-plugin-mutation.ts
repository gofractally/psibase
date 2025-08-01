import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import z from "zod";

import { supervisor } from "@/supervisor";

import { TxStatus, checkLastTx } from "@/lib/checkStaging";
import { zAccount } from "@/lib/zod/Account";

import { toast } from "@shared/shadcn/ui/sonner";

export const zParams = z.object({
    intf: zAccount,
    service: zAccount,
    method: z.string(),
});

type Params = z.infer<typeof zParams>;

type Meta<T> = {
    error: string;
    loading: string;
    success: string;
} & (
    | {
          isStagable?: false | undefined;
          onSuccess?: (params: T) => void;
      }
    | {
          isStagable: true;
          onSuccess?: (params: T, status: TxStatus) => void;
      }
);

export const usePluginMutation = <T>(
    { intf, method, service }: Params,
    { error, loading, success, isStagable = true, onSuccess }: Meta<T>,
) => {
    const navigate = useNavigate();

    return useMutation<void, Error, T, string | number>({
        mutationKey: [service, intf, method],
        onMutate: () => {
            const res = toast.loading(loading);
            return res;
        },
        mutationFn: async (paramsArray) => {
            await supervisor.functionCall({
                service,
                intf,
                method,
                params: z.any().array().parse(paramsArray),
            });
        },
        onError: (errorObj, params, id) => {
            console.error({ service, intf, method, params }, error);
            toast.error(error, {
                description: errorObj.message,
                id,
            });
        },
        onSuccess: async (_, networkName, id) => {
            if (isStagable) {
                const lastTx = await checkLastTx();
                if (onSuccess) {
                    onSuccess(networkName, lastTx);
                }
                if (lastTx.type == "executed") {
                    toast.success(success, {
                        id,
                        description: "Change is live.",
                    });
                } else {
                    toast.success(success, {
                        id,
                        description: "Change is proposed.",
                        action: {
                            label: "View",
                            onClick: () => {
                                navigate(
                                    `/pending-transactions/${lastTx.txId}`,
                                );
                            },
                        },
                    });
                }
            } else {
                toast.success(success, {
                    id,
                    description: "Change is live.",
                });
            }
        },
    });
};

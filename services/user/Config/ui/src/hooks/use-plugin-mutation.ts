import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import z from "zod";

import { supervisor } from "@/supervisor";

import { TxStatus, checkLastTx } from "@/lib/checkStaging";
import { zAccount } from "@/lib/zod/Account";

const zParams = z.object({
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
          onSuccess: (params: T) => void;
      }
    | {
          isStagable: true;
          onSuccess: (params: T, status: TxStatus) => void;
      }
);

export const usePluginMutation = <T>(
    { intf, method, service }: Params,
    { error, loading, success, isStagable = true, onSuccess }: Meta<T>,
) => {
    const navigate = useNavigate();

    return useMutation<void, Error, T, string | number>({
        mutationKey: [service, intf, method],
        onMutate: () => toast.loading(loading),
        mutationFn: async (paramsArray) => {
            await supervisor.functionCall({
                service,
                intf,
                method,
                params: paramsArray as any[],
            });
        },
        onError: (errorObj, _, id) => {
            console.error("useSetworkName:", error);
            toast.error(error, {
                description: errorObj.message,
                id,
            });
        },
        onSuccess: async (_, networkName, id) => {
            if (isStagable) {
                const lastTx = await checkLastTx();
                onSuccess(networkName, lastTx);
                if (lastTx.type == "executed") {
                    toast.success(success, {
                        id,
                        description: "Executed successfully.",
                    });
                } else {
                    toast.success(success, {
                        id,
                        description: "Proposal is awaiting approval.",
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
                    description: "Executed successfully.",
                });
            }
        },
    });
};

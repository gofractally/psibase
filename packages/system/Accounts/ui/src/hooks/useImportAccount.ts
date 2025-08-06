import { useMutation } from "@tanstack/react-query";

import { getSupervisor } from "@psibase/common-lib";

import { useGetAllAccounts } from "./useGetAllAccounts";

const supervisor = getSupervisor();

export const useImportAccount = () => {
    const { refetch: fetchAccounts } = useGetAllAccounts();

    return useMutation<void, string, string>({
        mutationFn: async (accountName) => {
            await supervisor.functionCall({
                method: "importAccount",
                params: [accountName],
                service: "accounts",
                intf: "admin",
            });
        },
        onSuccess: async () => {
            fetchAccounts();
            setTimeout(() => {
                fetchAccounts();
            }, 2000);
        },
    });
};

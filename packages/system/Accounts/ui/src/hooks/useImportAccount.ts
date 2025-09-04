import { useMutation } from "@tanstack/react-query";

import { getSupervisor } from "@psibase/common-lib";

import { useGetAllAccounts } from "./useGetAllAccounts";

const supervisor = getSupervisor();

export const useImportAccount = () => {
    const { refetch: fetchAccounts } = useGetAllAccounts();

    return useMutation<void, string, string>({
        mutationFn: async (accountName) => {
            console.log("useImportAccount().importAccount().1");
            await supervisor.functionCall({
                method: "importAccount",
                params: [accountName],
                service: "accounts",
                intf: "admin",
            });
            console.log("useImportAccount().importAccount().2");
        },
        onSuccess: async () => {
            fetchAccounts();
            setTimeout(() => {
                fetchAccounts();
            }, 2000);
        },
    });
};

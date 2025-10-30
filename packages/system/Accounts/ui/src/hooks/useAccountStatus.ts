import { queryClient, supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const zAccountNameStatus = z.enum(["Available", "Taken", "Invalid"]);
const GetAccountReturn = z
    .object({
        accountNum: z.string(),
        authService: z.string(),
        resourceBalance: z.boolean().or(z.bigint()),
    })
    .optional();

export type AccountNameStatus = z.infer<typeof zAccountNameStatus>;

export const isAccountAvailable = async (
    accountName: string,
): Promise<AccountNameStatus> => {
    try {
        const res = GetAccountReturn.parse(
            await supervisor.functionCall({
                method: "getAccount",
                params: [accountName],
                service: "accounts",
                intf: "api",
            }),
        );

        return zAccountNameStatus.parse(res ? "Taken" : "Available");
    } catch (e) {
        console.error(e);
        return zAccountNameStatus.parse("Invalid");
    }
};

const getQueryKey = (account: string | undefined) => ["userAccount", account];

export const useAccountStatus = (account: string | undefined) =>
    useQuery<AccountNameStatus>({
        queryKey: getQueryKey(account),
        queryFn: async () => isAccountAvailable(account!),
        enabled: !!account,
    });

export const fetchAccountStatus = async (
    account: string,
): Promise<AccountNameStatus> => {
    const cachedData = zAccountNameStatus
        .optional()
        .parse(queryClient.getQueryData(getQueryKey(account)));
    if (cachedData) return cachedData;

    const res = await isAccountAvailable(account);
    queryClient.setQueryData(getQueryKey(account), () => res);
    return res;
};

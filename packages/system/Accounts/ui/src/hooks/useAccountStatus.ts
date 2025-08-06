import { supervisor } from "@/main";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const AccountNameStatus = z.enum(["Available", "Taken", "Invalid", "Loading"]);
const GetAccountReturn = z
    .object({
        accountNum: z.string(),
        authService: z.string(),
        resourceBalance: z.boolean().or(z.bigint()),
    })
    .optional();

const isAccountAvailable = async (
    accountName: string,
): Promise<z.infer<typeof AccountNameStatus>> => {
    try {
        const res = GetAccountReturn.parse(
            await supervisor.functionCall({
                method: "getAccount",
                params: [accountName],
                service: "accounts",
                intf: "api",
            }),
        );

        return AccountNameStatus.parse(res ? "Taken" : "Available");
    } catch (e) {
        console.error(e);
        return AccountNameStatus.parse("Invalid");
    }
};

export const useAccountStatus = (debouncedAccount: string | undefined) =>
    useQuery<z.infer<typeof AccountNameStatus>>({
        queryKey: ["userAccount", debouncedAccount],
        queryFn: async () => isAccountAvailable(debouncedAccount!),
        enabled: !!debouncedAccount,
        initialData: "Loading",
    });

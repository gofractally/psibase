import { Account } from "@/lib/zodTypes";
import { supervisor } from "@/supervisor";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

export const AccountNameStatus = z.enum(["Available", "Taken", "Invalid"]);
const GetAccountReturn = z
  .object({
    accountNum: z.string(),
    authService: z.string(),
    resourceBalance: z.boolean().or(z.bigint()),
  })
  .optional();

export const isAccountAvailable = async (
  accountName: string
): Promise<z.infer<typeof AccountNameStatus>> => {
  try {
    const res = GetAccountReturn.parse(
      await supervisor.functionCall({
        method: "getAccount",
        params: [accountName],
        service: "accounts",
        intf: "api",
      })
    );

    return AccountNameStatus.parse(res ? "Taken" : "Available");
  } catch (e) {
    // TODO: read this error, actually throw if there's something wrong, other than being invalid
    console.error(e);
    return AccountNameStatus.parse("Invalid");
  }
};

export const useAccountStatus = (account: string | undefined) =>
  useQuery<z.infer<typeof AccountNameStatus>>({
    queryKey: ["userAccount", account],
    queryFn: async () => {
      return isAccountAvailable(Account.parse(account));
    },
    staleTime: 10000,
    enabled: !!account,
  });

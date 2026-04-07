import { supervisor } from "@shared/lib/supervisor";
import {
    MAX_PREMIUM_NAME_LENGTH,
    zAccount,
} from "@shared/lib/schemas/account";

export const PREM_ACCOUNTS_SERVICE = "prem-accounts";

/** Shared `zAccount` rules with the PremAccounts premium name length cap. */
export const zPremiumAccountName = zAccount.refine(
    (val) => val.length <= MAX_PREMIUM_NAME_LENGTH,
    {
        message: `Premium account names must be at most ${MAX_PREMIUM_NAME_LENGTH} characters.`,
    },
);

export async function doesAccountExist(accountName: string): Promise<boolean> {
    try {
        const res = await supervisor.functionCall({
            method: "getAccount",
            params: [accountName],
            service: "accounts",
            intf: "api",
        });
        return Boolean(res && typeof res === "object" && "accountNum" in res);
    } catch {
        return false;
    }
}

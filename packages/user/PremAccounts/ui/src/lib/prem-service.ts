import { supervisor } from "@shared/lib/supervisor";

export const PREM_ACCOUNTS_SERVICE = "prem-accounts";

export const MIN_PREMIUM_NAME_LENGTH = 1;
export const MAX_PREMIUM_NAME_LENGTH = 10;

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

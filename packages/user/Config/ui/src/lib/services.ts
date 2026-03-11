import { zAccount } from "./zod/Account";

export const CONFIG = zAccount.parse("config");
export const PRODUCERS = zAccount.parse("producers");
export const PREM_ACCOUNTS = zAccount.parse("prem-accounts");

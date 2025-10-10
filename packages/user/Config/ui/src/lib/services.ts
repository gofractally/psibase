import { zAccount } from "./zod/Account";

export const CONFIG = zAccount.parse("config");
export const PRODUCERS = zAccount.parse("producers");

import { zAccount } from "./zod/Account";

export const CONFIG = zAccount.parse("config");

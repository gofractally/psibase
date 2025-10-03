import { zAccount } from "./zod/Account";

export const evaluationsService = zAccount.parse("evaluations");
export const fractalsService = zAccount.parse("fractals");

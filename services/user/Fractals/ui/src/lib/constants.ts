import { zAccount } from "./zod/Account";

export const fractalsService = zAccount.parse("fractals");
export const evaluationsService = zAccount.parse("evaluations");

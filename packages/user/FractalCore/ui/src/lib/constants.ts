import { zAccount } from "./zod/Account";

export const EVALUATIONS_SERVICE = zAccount.parse("evaluations");
export const FRACTALS_SERVICE = zAccount.parse("fractals");
export const COUNCIL_SEATS = 6;

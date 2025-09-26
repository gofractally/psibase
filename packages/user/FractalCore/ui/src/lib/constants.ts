import { zAccount } from "./zod/Account";

export const fractalService = window.location.hostname;
console.log({ fractalService });

export const evaluationsService = zAccount.parse("evaluations");

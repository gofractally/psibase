import { Account } from "./zod/Account";

export const paths = {
    guild: {
        evaluations: (guild: Account) => `/guild/${guild}/evaluations`,
        evaluationGroup: (guild: Account, groupNumber: number) =>
            `/guild/${guild}/evaluations/group/${groupNumber}`,
    },
};

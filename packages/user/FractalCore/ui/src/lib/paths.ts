import { Account } from "./zod/Account";

export const paths = {
    guild: {
        evaluations: (fractal: Account) => `/fractal/${fractal}/evaluations`,
        evaluationGroup: (guild: Account, groupNumber: number) =>
            `/guild/${guild}/evaluations/group/${groupNumber}`,
    },
};

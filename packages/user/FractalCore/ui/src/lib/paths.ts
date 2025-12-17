import { Account } from "@shared/lib/schemas/account";

export const paths = {
    guild: {
        evaluations: (guild: Account) => `/guild/${guild}/evaluations`,
        evaluationGroup: (guild: Account, groupNumber: number) =>
            `/guild/${guild}/evaluations/group/${groupNumber}`,
    },
};

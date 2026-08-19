import { Account } from "@shared/lib/schemas/account";

export const paths = {
    guild: {
        evaluations: (guild: Account) => `/guild/${guild}/evaluations/upcoming`,
        evaluationGroup: (guild: Account, groupNumber: number) =>
            `/guild/${guild}/evaluations/group/${groupNumber}`,
        membership: {
            applicants: (guild: Account) =>
                `/guild/${guild}/membership/applicants`,
            members: (guild: Account) => `/guild/${guild}/membership/members`,
        },
    },
    fractal: {
        members: () => `/members`,
    },
};

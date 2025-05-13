import { Account } from "./zod/Account";

export const paths = {
    fractal: {
        evaluations: (fractal: Account) => `/fractal/${fractal}/evaluations`,
        evaluationGroup: (
            fractal: Account,
            evaluationId: number,
            groupNumber: number,
        ) => `/fractal/${fractal}/evaluations/${evaluationId}/${groupNumber}`,
    },
};

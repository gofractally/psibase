import { z } from "zod";

import { EVALUATIONS_SERVICE } from "@shared/domains/fractal/lib/constants";
import { supervisor } from "@shared/lib/supervisor";

export const getProposal = async (
    owner: string,
    evaluationId: number,
    groupId: number,
) => {
    const pars = {
        method: "getProposal",
        params: [owner, evaluationId, groupId],
        service: EVALUATIONS_SERVICE,
        intf: "user",
    };
    const res = await supervisor.functionCall(pars);

    return z.number().array().parse(Array.from(res));
};

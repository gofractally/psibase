import { z } from "zod";

import { supervisor } from "@shared/lib/supervisor";

export const getProposal = async (
    owner: string,
    evaluationId: number,
    groupId: number,
) => {
    const pars = {
        method: "getProposal",
        params: [owner, evaluationId, groupId],
        service: "evaluations",
        intf: "user",
    };
    const res = await supervisor.functionCall(pars);

    return z.number().array().parse(Array.from(res));
};

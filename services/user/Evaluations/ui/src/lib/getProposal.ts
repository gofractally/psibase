import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

export const getProposal = async (
    owner: string,
    evaluationId: number,
    groupId: number,
) => {
    const supervisor = getSupervisor();

    const pars = {
        method: "getProposal",
        params: [owner, evaluationId, groupId],
        service: "evaluations",
        intf: "user",
    };
    const res = await supervisor.functionCall(pars);

    return z.number().array().parse(Array.from(res));
};

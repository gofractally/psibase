import { getSupervisor } from "@psibase/common-lib";
import { z } from "zod";

export const getProposal = async (
    evaluationId: number,
    groupId: number,
    currentUser: string,
) => {
    const supervisor = getSupervisor();

    const pars = {
        method: "getProposal",
        params: [evaluationId, groupId, currentUser],
        service: "evaluations",
        intf: "api",
    };
    const res = await supervisor.functionCall(pars);

    return z.number().array().parse(Array.from(res));
};

import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

export const useCloseEvaluation = () => {
    const navigate = useNavigate();
    return useMutation({
        mutationFn: async (evaluationId: number) => {
            void (await getSupervisor().functionCall({
                method: "close",
                service: "evaluations",
                intf: "api",
                params: [evaluationId],
            }));
            navigate(`/`);
        },
    });
};

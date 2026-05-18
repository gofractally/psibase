import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { supervisor } from "@shared/lib/supervisor";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Params = z.object({
    evaluationId: z.number(),
});

export const useCloseEvaluation = () => {
    const navigate = useNavigate();
    return useMutation({
        mutationFn: async (params: z.infer<typeof Params>) => {
            void (await supervisor.functionCall({
                method: "close",
                service: "evaluations",
                intf: "admin",
                params: [params.evaluationId],
            }));
            navigate(`/`);
        },
    });
};

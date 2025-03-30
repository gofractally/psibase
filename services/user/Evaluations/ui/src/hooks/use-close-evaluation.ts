import { getSupervisor } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

const CloseParams = z.object({
    id: z.number(),
});

export const useCloseEvaluation = () => {
    const navigate = useNavigate();
    return useMutation({
        mutationFn: async (params: z.infer<typeof CloseParams>) => {
            const { id } = CloseParams.parse(params);
            void (await getSupervisor().functionCall({
                method: "close",
                service: "evaluations",
                intf: "api",
                params: [id],
            }));
            navigate(`/`);
        },
    });
};

import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { getSupervisor } from "@psibase/common-lib";

import { fractalsService } from "@/lib/constants";
import { paths } from "@/lib/paths";

import { toast } from "@shared/shadcn/ui/sonner";

import { useCurrentFractal } from "../use-current-fractal";
import { updateAttestation } from "./use-users-and-groups";

export const zParams = z.object({
    evaluationId: z.number(),
    groupNumber: z.number(),
});

export const useAttest = () => {
    const navigate = useNavigate();
    const fractal = useCurrentFractal();

    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            await toast.promise(
                getSupervisor().functionCall({
                    method: "attest",
                    service: fractalsService,
                    intf: "user",
                    params: [params.evaluationId, params.groupNumber],
                }),
                {
                    error: (error) => {
                        console.log("Attest error:", error);
                        return "Unable to attest";
                    },
                },
            );

            // HACK
            // for optimistic update purposes
            // The UI doesn't know what the attestation is nor does it care, merely that one has been made by the current user
            // so the rest of the app knows that the user has done his duty in attesting the group results and doesn't need to render a
            // the real attestation will be over-written by the next graphql query
            updateAttestation(params.evaluationId, [1, 2, 3, 4, 5, 6]);
        },
        onSuccess: () => {
            navigate(paths.fractal.evaluations(fractal!));
        },
    });
};

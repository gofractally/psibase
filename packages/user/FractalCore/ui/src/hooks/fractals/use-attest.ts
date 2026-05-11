import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { paths } from "@/lib/paths";
import { zGuildAccount } from "@/lib/zod/wrappers";

import { supervisor } from "@shared/lib/supervisor";
import { toast } from "@shared/shadcn/ui/sonner";

import { useFractalAccount } from "./use-fractal-account";
import { updateAttestation } from "./use-users-and-groups";

export const zParams = z.object({
    guildAccount: zGuildAccount,
    groupNumber: z.number(),
});

export const useAttest = () => {
    const navigate = useNavigate();
    const fractal = useFractalAccount();

    return useMutation({
        mutationFn: async (params: z.infer<typeof zParams>) => {
            const { guildAccount, groupNumber } = zParams.parse(params);
            await supervisor.functionCall({
                method: "attest",
                service: fractal,
                intf: "userEval",
                params: [guildAccount, groupNumber],
            });

            // HACK
            // for optimistic update purposes
            // The UI doesn't know what the attestation is nor does it care, merely that one has been made by the current user
            // so the rest of the app knows that the user has done his duty in attesting the group results and doesn't need to render a
            // the real attestation will be over-written by the next graphql query
            updateAttestation(999999999999, [1, 2, 3, 4, 5, 6]);
        },
        onSuccess: (_data, { guildAccount }) => {
            navigate(paths.guild.evaluations(guildAccount));
        },
        onError: (error) => {
            // Attest error: PluginError: Transaction error: service 'evaluations' aborted with message: user myprod has already submitted
            console.error("Attest error:", error);
            if (error.message.includes("already submitted")) return;
            toast.error("Unable to attest", {
                description: error.message,
            });
        },
    });
};

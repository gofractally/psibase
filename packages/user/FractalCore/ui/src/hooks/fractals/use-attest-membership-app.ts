import { queryClient } from "@/queryClient";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { getGuildApplication } from "@/lib/graphql/fractals/getGuildApplication";
import { fractalCorePlugin } from "@/lib/plugin";
import QueryKey from "@/lib/queryKeys";
import { zGuildAccount } from "@/lib/zod/Wrappers";

import { zAccount } from "@shared/lib/schemas/account";
import { toast } from "@shared/shadcn/ui/sonner";

import { usePluginMutation } from "../use-plugin-mutation";

export const zParams = z.object({
    guildAccount: zGuildAccount,
    member: zAccount,
    comment: z.string(),
    endorses: z.boolean(),
});

export const useAttestMembershipApp = () => {
    const navigate = useNavigate();

    return usePluginMutation(fractalCorePlugin.userGuild.attestMembershipApp, {
        error: "Failed attesting membership",
        loading: "Attesting",
        success: "Attested",
        isStagable: false,
        onSuccess: async ([guildAccount, member]) => {
            const guildApplication = await getGuildApplication(
                guildAccount,
                member,
            );
            if (guildApplication === null) {
                toast.success(`${member} is now a member of the guild.`);
                navigate(`/guild/${guildAccount}/members`);
            }

            queryClient.setQueryData(
                QueryKey.guildApplication(guildAccount, member),
                () => guildApplication,
            );
        },
    });
};

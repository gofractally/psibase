import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { fractalCorePlugin } from "@/lib/plugin";
import { zGuildAccount } from "@/lib/zod/Wrappers";

import { zAccount } from "@shared/lib/schemas/account";
import { toast } from "@shared/shadcn/ui/sonner";

import { usePluginMutation } from "../use-plugin-mutation";

export const zParams = z.object({
    guildAccount: zGuildAccount,
    member: zAccount,
    accepted: z.boolean(),
});

export const useConcludeMembershipApplication = () => {
    const navigate = useNavigate();

    return usePluginMutation(fractalCorePlugin.adminGuild.conMembershipApp, {
        error: "Failed processing membership application",
        loading: "Processing membership application",
        success: "Membership application processed",
        isStagable: false,
        onSuccess: async ([guildAccount, member, accepted]) => {
            if (accepted) {
                toast.success(`${member} is now a member of the guild.`);
            } else {
                toast.error(`${member}'s application has been rejected.`);
            }
            navigate(`/guild/${guildAccount}/membership/applicants`);
        },
    });
};

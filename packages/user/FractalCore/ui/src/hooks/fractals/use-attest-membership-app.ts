import { queryClient } from "@/queryClient";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { getGuildApplication } from "@/lib/graphql/fractals/getGuildApplication";
import QueryKey from "@/lib/queryKeys";
import { Account, zAccount } from "@/lib/zod/Account";
import { zGuildAccount } from "@/lib/zod/Wrappers";

import { toast } from "@shared/shadcn/ui/sonner";

import { usePluginMutation } from "../use-plugin-mutation";
import { useFractalAccount } from "./use-fractal-account";

export const zParams = z.object({
    guildAccount: zGuildAccount,
    member: zAccount,
    comment: z.string(),
    endorses: z.boolean(),
});

export const useAttestMembershipApp = () => {
    const fractal = useFractalAccount();
    const navigate = useNavigate();

    return usePluginMutation<
        [
            guildAccount: Account,
            member: Account,
            comment: string,
            endorses: boolean,
        ]
    >(
        {
            method: "attestMembershipApp",
            service: fractal,
            intf: "userGuild",
        },
        {
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
        },
    );
};

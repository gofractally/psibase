import { z } from "zod";

import { fractalCorePlugin } from "@/lib/plugin";

import { zAccount } from "@shared/lib/schemas/account";

import { usePluginMutation } from "../use-plugin-mutation";

export const zParams = z.object({
    account: zAccount,
    name: z.string().min(1, { message: "Name is required." }),
});

export const useCreateGuild = () =>
    usePluginMutation(fractalCorePlugin.adminGuild.createGuild, {
        error: "Failed creating guild",
        loading: "Creating guild",
        success: "Created guild",
    });

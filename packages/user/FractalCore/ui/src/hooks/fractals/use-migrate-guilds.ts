import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginFunctionCallMutation } from "../use-plugin-function-call-mutation";

export const useMigrateGuilds = () =>
    usePluginFunctionCallMutation(fractalCorePlugin.adminFractal.migrateGuilds, {});

import { fractalCorePlugin } from "@/lib/plugin";

import { usePluginFunctionCallMutation } from "../use-plugin-function-call-mutation";

export const useSetRoleMapping = () =>
    usePluginFunctionCallMutation(fractalCorePlugin.adminFractal.setRoleMapping, {});

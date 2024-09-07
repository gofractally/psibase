import { SupervisorContext } from "@contexts/supervisor";
import { PluginId } from "@psibase/common-lib/messaging";
import { useContext } from "react";

export const useSupervisor = ({
    preloadPlugins,
}: {
    preloadPlugins?: PluginId[];
} = {}) => {
    const supervisorContext = useContext(SupervisorContext);

    if (!supervisorContext) {
        throw new Error(`Supervisor context not available`);
    }
    supervisorContext.onLoaded().then(() => {
        if (preloadPlugins && preloadPlugins.length > 0) {
            supervisorContext.preLoadPlugins(preloadPlugins);
        }
    });

    return supervisorContext!;
};

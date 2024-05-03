import { SupervisorContext } from "@/context";
import { PluginId } from "@psibase/common-lib/messaging";
import { useContext } from "react";

export const useSupervisor = ({
  preloadPlugins,
}: {
  preloadPlugins: PluginId[];
}) => {
  const supervisorContext = useContext(SupervisorContext);

  if (!supervisorContext) {
    throw new Error(`Supervisor context not available`);
  }
  supervisorContext.onLoaded().then(() => {
    supervisorContext.preLoadPlugins(preloadPlugins);
  });

  return supervisorContext!;
};

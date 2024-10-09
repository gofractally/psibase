import { Supervisor } from "@psibase/common-lib";

const supervisor = new Supervisor();
export const getSupervisor = async () => {
    if (supervisor.isSupervisorInitialized) return supervisor;
    await supervisor.onLoaded();
    supervisor.preLoadPlugins([
        { service: "accounts" },
        { service: "workshop" },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 3000)); // tolerance to preload plugins
    return supervisor;
};

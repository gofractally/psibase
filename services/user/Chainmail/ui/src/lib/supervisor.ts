import { Supervisor } from "@psibase/common-lib";

const supervisor = new Supervisor();
export const getSupervisor = async () => {
    if (supervisor.isSupervisorInitialized) return supervisor;
    await supervisor.onLoaded();
    return supervisor;
};

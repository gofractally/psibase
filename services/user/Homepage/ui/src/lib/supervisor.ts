import { Supervisor } from "@psibase/common-lib";

const supervisor = new Supervisor({
    supervisorSrc: `https://supervisor.${window.location.host}`,
});

export const getSupervisor = async () => {
    if (supervisor.isSupervisorInitialized) return supervisor;
    await supervisor.onLoaded();
    return supervisor;
};

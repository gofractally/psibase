import { Supervisor } from "@psibase/common-lib";

const supervisor = new Supervisor();

export const getSupervisor = async () => {
    await supervisor.onLoaded();
    return supervisor;
};

import { Supervisor, siblingUrl } from "@psibase/common-lib";   

const supervisorSrc = siblingUrl(undefined, "supervisor", undefined, false);

export const supervisor = new Supervisor({
    supervisorSrc,
});
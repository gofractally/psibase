import { getSupervisor, siblingUrl } from "@psibase/common-lib";

export const supervisor = getSupervisor({
    supervisorSrc: siblingUrl(undefined, "supervisor", undefined, false),
});

import { Supervisor } from "@psibase/common-lib";
import { createContext } from "react";

export const SupervisorContext = createContext<Supervisor | undefined>(
    undefined,
);

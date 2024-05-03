import { Supervisor } from "@psibase/common-lib/messaging";
import { createContext } from "react";


export const SupervisorContext = createContext<Supervisor | undefined>(undefined);

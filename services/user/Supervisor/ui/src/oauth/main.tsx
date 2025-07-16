import React from "react";
import ReactDOM from "react-dom/client";

import { getSupervisor } from "@psibase/common-lib";

import { App } from "./App";

export const supervisor = getSupervisor();

ReactDOM.createRoot(document.getElementById("app")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { getSupervisor } from "@psibase/common-lib";

export const supervisor = getSupervisor();

ReactDOM.createRoot(document.getElementById("app")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

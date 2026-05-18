import { getSupervisor } from "@psibase/common-lib";

import "./app.css";
import { LoginBar } from "./login-bar";
import { PluginLoader } from "./plugin-loader";

const supervisor = getSupervisor();

export default function App() {
    return (
        <>
            <LoginBar supervisor={supervisor} />
            <PluginLoader supervisor={supervisor} />
        </>
    );
}

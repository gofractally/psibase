import { getSupervisor } from "@psibase/common-lib";

import "./App.css";
import { LoginBar } from "./LoginBar";
import { PluginLoader } from "./PluginLoader";

const supervisor = getSupervisor();

export default function App() {
    return (
        <>
            <LoginBar supervisor={supervisor} />
            <PluginLoader supervisor={supervisor} />
        </>
    );
}

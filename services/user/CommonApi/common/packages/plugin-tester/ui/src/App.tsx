import "./App.css";
import { getSupervisor } from "@psibase/common-lib";
import { PluginLoader } from "./PluginLoader";
import { LoginBar } from "./LoginBar";

const supervisor = getSupervisor();

export default function App() {
  return (
    <>
      <LoginBar supervisor={supervisor} />
      <PluginLoader supervisor={supervisor} />
    </>
  );
}

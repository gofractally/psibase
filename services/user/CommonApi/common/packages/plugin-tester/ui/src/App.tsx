import "./App.css";
import { Supervisor } from "@psibase/common-lib";
import { PluginLoader } from "./PluginLoader";
import { LoginBar } from "./LoginBar";

const supervisor = new Supervisor();

function App() {
  return (
    <>
      <LoginBar supervisor={supervisor} />
      <PluginLoader supervisor={supervisor} />
    </>
  );
}

export default App;

import { getSupervisor } from "@psibase/common-lib";
import { FormEvent, useEffect, useState } from "react";

import "./app.css";

const supervisor = getSupervisor();

export const App = () => {
  const [changesMade, setChangesMade] = useState(false);
  const [exampleThing, setExampleThing] = useState("");
  const [status, setStatus] = useState("");
  const thisServiceName = "{{project-name}}";

  useEffect(() => {
    const init = async () => {
      await supervisor.onLoaded();
      await getExampleThing();
    };
    init().catch((e) => setStatus(String(e)));
  }, []);

  const getExampleThing = async () => {
    const value = (await supervisor.functionCall({
      service: thisServiceName,
      intf: "queries",
      method: "getExampleThing",
      params: [],
    })) as string;
    setExampleThing(value);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await supervisor.functionCall({
        service: thisServiceName,
        intf: "api",
        method: "setExampleThing",
        params: [exampleThing],
      });
      setChangesMade(false);
      setStatus("Saved");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main className="app">
      <h1>{{project-name | title_case}}</h1>
      <form onSubmit={save}>
        <label htmlFor="exampleThing">Example thing</label>
        <input
          id="exampleThing"
          className="field"
          value={exampleThing}
          onChange={(e) => {
            setExampleThing(e.target.value);
            setChangesMade(true);
          }}
        />
        <button type="submit" disabled={!changesMade}>
          Save
        </button>
      </form>
      {status ? <p>{status}</p> : null}
    </main>
  );
};

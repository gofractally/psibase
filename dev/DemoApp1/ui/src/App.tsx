import "./App.css";
import { Supervisor } from "@psibase/common-lib";
import React, { ChangeEvent, useEffect, useState } from "react";

import { fetchAnswers } from "./utils/fetchAnswers";
import { wait } from "./utils/wait";

const supervisor = new Supervisor();

enum InviteState {
  Pending = "Pending",
  Accepted = "Accepted",
  Rejected = "Rejected"
}
interface Invite {
  inviter: string,
  app: string,
  state: InviteState,
  actor: string,
  expiry: string,
  callback: string,
}

const FileSelector: React.FC<{ onLoad: (content: string) => void }> = ({
  onLoad,
}) => {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files ? event.target.files[0] : null;

    if (file) {
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        const text = e.target?.result;
        onLoad(text as string);
      };
      reader.readAsText(file);
    }
  };

  return <input type="file" accept=".pem" onChange={handleFileChange} />;
};

function App() {
  const [res, setRes] = useState("Empty");

  const init = async () => {
    await supervisor.onLoaded();
    supervisor.preLoadPlugins([
      { service: "invite" },
      { service: "accounts" },
      { service: "auth-sig" },
      { service: "demoapp1" },
    ]);
  };

  useEffect(() => {
    init();
  }, []);

  const run = async () => {
    try {
      const res = await supervisor.functionCall({
        service: "auth-sig",
        intf: "keyvault",
        method: "generateKeypair",
        params: [],
      });
      setRes(res as string);
    } catch (e) {
      if (e instanceof Error) {
        console.error(`Error: ${e.message}\nStack: ${e.stack}`);
      } else {
        console.error(`Caught exception: ${JSON.stringify(e, null, 2)}`);
      }
    }
  };

  const run2 = async () => {
    try {
      const res = await supervisor.functionCall({
        service: "demoapp1",
        intf: "intf",
        method: "helloworld2",
        params: [],
      });
      setRes(res as string);
    } catch (e) {
      console.error(`${JSON.stringify(e, null, 2)}`);
    }
  };

  
  const run3 = async () => {
    try {
      const inviteUrl: string = (await supervisor.functionCall({
        service: "invite",
        intf: "inviter",
        method: "generateInvite",
        params: ["/subpath"],
      })) as string;
      console.log(`Got invite URL: ${inviteUrl}`);

      const id: string | null = new URL(inviteUrl).searchParams.get("id");
      if (id !== null) {
        console.log(`Invite ID: ${id}`);
      } else {
        setRes("id in URL was null");
      }
    } catch (e) {
      console.error(`${JSON.stringify(e, null, 2)}`);
    }
  };

  const run4 = async () => {
    const inviteId: string = d;
    try {
      const inviteObject: Invite = (await supervisor.functionCall({
        service: "invite",
        intf: "invitee",
        method: "decodeInvite",
        params: [inviteId],
      })) as Invite;
      console.log(
        `Decoded invite object: ${JSON.stringify(inviteObject, null, 2)}`
      );
      setRes(`Invited by: ${inviteObject.inviter}`);
    } catch (e) {
      console.error(`${JSON.stringify(e, null, 2)}`);
    }
  };

  const run5 = async () => {
    try {
      const res = await supervisor.functionCall({
        service: "demoapp1",
        intf: "intf",
        method: "multiply",
        params: [Number(a), Number(b)],
      });
      for (let i = 0; i < 5; i++) {
        const { answer } = await fetchAnswers();
        setAnswer(answer.result.toString());
        await wait(1000);
      }
      setRes(res as string);
    } catch (e) {
      console.error(`${JSON.stringify(e, null, 2)}`);
    }
  };

  const run6 = async () => {
    try {
      const res = await supervisor.functionCall({
        service: "auth-sig",
        intf: "keyvault",
        method: "generateUnmanagedKeypair",
        params: [],
      });
      console.log(`Decoded response: ${JSON.stringify(res, null, 2)}`);
      setRes(`Keypair written to console`);
    } catch (e) {
      if (e instanceof Error) {
        console.error(`Error: ${e.message}\nStack: ${e.stack}`);
      } else {
        console.error(`Caught exception: ${JSON.stringify(e, null, 2)}`);
      }
    }
  };

  const run7 = async () => {
    try {
      const res = await supervisor.functionCall({
        service: "auth-sig",
        intf: "actions",
        method: "setKey",
        params: [c],
      });
      console.log(`Decoded response: ${JSON.stringify(res, null, 2)}`);
      setRes(`Res: ${res}`);
    } catch (e) {
      if (e instanceof Error) {
        console.error(`Error: ${e.message}\nStack: ${e.stack}`);
      } else {
        console.error(`Caught exception: ${JSON.stringify(e, null, 2)}`);
      }
    }
  };

  const run8 = async () => {
    try {
      await supervisor.functionCall({
        service: "accounts",
        intf: "accounts",
        method: "loginTemp",
        params: ["alice"],
      });

      await supervisor.functionCall({
        service: "tokens",
        intf: "transfer",
        method: "credit",
        params: ["1", "bob", "12.0000", ""],
      });

      await supervisor.functionCall({
        service: "accounts",
        intf: "accounts",
        method: "loginTemp",
        params: ["bob"],
      });

      await supervisor.functionCall({
        service: "tokens",
        intf: "transfer",
        method: "credit",
        params: ["1", "alice", "6.0000", ""],
      });

    } catch (e) {
      if (e instanceof Error) {
        console.error(`Error: ${e.message}\nStack: ${e.stack}`);
      } else {
        console.error(`Caught exception: ${JSON.stringify(e, null, 2)}`);
      }
    }
  };

  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  const [d, setD] = useState("");
  const [answer, setAnswer] = useState("?");

  return (
    <>
      <h1>Psibase Demo App 1</h1>
      <h3>{res}</h3>
      <div className="card">
        <button onClick={() => run()}>
          {"auth-sig:plugin->generateKeypair"}
        </button>
      </div>

      <div className="card">
        <button onClick={() => run2()}>{"demoapp1:plugin->helloworld2"}</button>
      </div>

      <div className="card">
        <button onClick={() => run3()}>{"Generate invite"}</button>
      </div>

      <div className="card">
        <input type="text" onChange={(e) => setD(e.target.value)} />
        <button onClick={() => run4()}>{"Decode invite"}</button>
      </div>

      <div className="card">
        <button onClick={() => run5()}>{"Multiplication on blockchain"}</button>
        <input type="text" onChange={(e) => setA(e.target.value)} />
        x
        <input type="text" onChange={(e) => setB(e.target.value)} />
        {answer}
      </div>

      <div className="card">
        <button onClick={() => run6()}>{"Generate unmanaged keypair"}</button>
      </div>

      <div className="card">
        <button onClick={() => run7()}>{"Set key"}</button>
        <FileSelector onLoad={setC} />
      </div>

      <div className="card">
        <button onClick={() => run8()}>{"Example token transfers"}</button>
      </div>
    </>
  );
}

export default App;

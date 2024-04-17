import "./App.css";
import { Supervisor } from "@psibase/common-lib/messaging";
import { useEffect, useState } from "react";
import { fetchAnswers } from "./utils/fetchAnswers";
import { wait } from "./utils/wait";

const supervisor = new Supervisor();

interface Invite {
  inviter: string;
  app: string;
  callback: string;
}

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
      console.error(`${JSON.stringify(e, null, 2)}`);
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

  const run5 = async () => {
    try {
      const res = await supervisor.functionCall({
        service: "demoapp1",
        intf: "intf",
        method: "multipli",
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

  const run3 = async () => {
    try {
      console.log("trying to run the inviteUrl...");
      const inviteUrl: string = (await supervisor.functionCall({
        service: "invite",
        intf: "inviter",
        method: "generateInvite",
        params: ["/subpath"],
      })) as string;
      console.log(`Got invite URL: ${inviteUrl}`);
      const id: string | null = new URL(inviteUrl).searchParams.get("id");
      if (id !== null) {
        const inviteObject: Invite = (await supervisor.functionCall({
          service: "invite",
          intf: "invitee",
          method: "decodeInvite",
          params: [id as string],
        })) as Invite;
        console.log(
          `Decoded invite object: ${JSON.stringify(inviteObject, null, 2)}`
        );
        setRes(`Invited by: ${inviteObject.inviter}`);
      } else {
        setRes("id in URL was null");
      }

      // eyJpbnZpdGVyIjoiYWxpY2UiLCJhcHAiOiJkZW1vYXBwMSIsInBrIjoiUFVCX0sxXzdqVGRNWUVhSGk2NlpFY3JoN1RvOVhLaW5nVmtSZEJ1ejZhYm0zbWVGYkd3OHpGRnZlIiwiY2IiOiJodHRwczovL2RlbW9hcHAxLnBzaWJhc2UuMTI3LjAuMC4xLnNzbGlwLmlvOjgwOTAvc3VicGF0aCJ9
    } catch (e) {
      console.error(`${JSON.stringify(e, null, 2)}`);
    }
  };

  const run4 = async () => {
    const inviteId: string =
      "eyJpbnZpdGVyIjoiYWxpY2UiLCJhcHAiOiJkZW1vYXBwMSIsInBrIjoiUFVCX0sxXzdqVGRNWUVhSGk2NlpFY3JoN1RvOVhLaW5nVmtSZEJ1ejZhYm0zbWVGYkd3OHpGRnZlIiwiY2IiOiJodHRwczovL2RlbW9hcHAxLnBzaWJhc2UuMTI3LjAuMC4xLnNzbGlwLmlvOjgwOTAvc3VicGF0aCJ9";
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

  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [answer, setAnswer] = useState("?");

  return (
    <>
      <h1>Psibase Demo App 1 1</h1>
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
        <button onClick={() => run3()}>{"Generate and decode invite"}</button>
      </div>

      <div className="card">
        <button onClick={() => run4()}>{"Just decode"}</button>
      </div>

      <div className="card">
        <button onClick={() => run5()}>{"Multiplication on blockchain"}</button>
        <input type="text" onChange={(e) => setA(e.target.value)} />
        x
        <input type="text" onChange={(e) => setB(e.target.value)} />
        {answer}
      </div>
    </>
  );
}

export default App;

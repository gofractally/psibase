import "./App.css";
import { Supervisor } from "@psibase/common-lib/messaging";
import { useEffect, useState } from "react";

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
      { service: "invite-sys" },
      { service: "account-sys" },
      { service: "auth-sys" },
      { service: "demoapp1" },
    ]);
  };

  useEffect(() => {
    init();
  }, []);

  const run = async () => {
    try {
      const res = await supervisor.functionCall({
        service: "auth-sys",
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

  const run3 = async () => {
    try {
      const inviteUrl: string = (await supervisor.functionCall({
        service: "invite-sys",
        intf: "inviter",
        method: "generateInvite",
        params: ["/subpath"],
      })) as string;
      console.log(`Got invite URL: ${inviteUrl}`);
      const id: string | null = new URL(inviteUrl).searchParams.get("id");
      if (id !== null) {
        const inviteObject: Invite = (await supervisor.functionCall({
          service: "invite-sys",
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
        service: "invite-sys",
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

  return (
    <>
      <h1>Psibase Demo App 1</h1>
      <h3>{res}</h3>
      <div className="card">
        <button onClick={() => run()}>
          {"auth-sys:plugin->generateKeypair"}
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
    </>
  );
}

export default App;

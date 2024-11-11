import "./App.css";
import { Supervisor } from "@psibase/common-lib";
import { useEffect, useState } from "react";

const supervisor = new Supervisor();

function App() {
  const [res, setRes] = useState("Empty");

  const init = async () => {
    await supervisor.onLoaded();
    supervisor.preLoadPlugins([
      { service: "invite" },
      { service: "accounts" },
      { service: "auth-sig" },
      { service: "demoapp1" },
      // { service: "identity" },
    ]);
  };

  useEffect(() => {
    init();
  }, []);

  const login = async () => {
    await supervisor.functionCall({
      service: "accounts",
      intf: "activeApp",
      method: "login",
      params: [user],
    });

    const connectedAccounts: string[] = (await supervisor.functionCall({
      service: "accounts",
      intf: "activeApp",
      method: "getConnectedAccounts",
      params: [],
    })) as string[];

    setRes(`Connected accounts: ${connectedAccounts.join(", ")}`);
  };

  const helloWorld = async () => {
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

  const generateInvite = async () => {
    try {
      const token: string = (await supervisor.functionCall({
        service: "invite",
        intf: "inviter",
        method: "generateInvite",
        params: [],
      })) as string;
      setInviteToken(token);
      console.log(`Got invite Token: ${token}`);
    } catch (e) {
      console.error(`${JSON.stringify(e, null, 2)}`);
    }
  };

  const decodeInvite = async () => {
    try {
      const inviteInfo: string = (await supervisor.functionCall({
        service: "invite",
        intf: "invitee",
        method: "decodeInvite",
        params: [inviteToken],
      })) as string;
      console.log(`Decoded invite: ${JSON.stringify(inviteInfo, null, 2)}`);
    } catch (e) {
      console.error(`${JSON.stringify(e, null, 2)}`);
    }
  };

  // Commenting this out because it was delivered broken...
  // Needs an identity package that can be installed by default
  //
  // const [claim, setClaim] = useState<number>(0.95);
  // const [attestee, setAttestee] = useState<string>("bob");
  // useState<string>(
  //   `{"attestation_type": "notIdentity", "subject": "bob", "claim": "My test claim", "score": 0.95}`
  // );
  // const attestIdentity = async () => {
  //   const res = await supervisor.functionCall({
  //     service: "identity",
  //     intf: "api",
  //     method: "attestIdentityClaim",
  //     params: [attestee, claim],
  //   });
  //   setRes(res as string);
  // };
  // const getIdentitySummary = async () => {
  //   const res = await supervisor.functionCall({
  //     service: "identity",
  //     intf: "queries",
  //     method: "summary",
  //     params: [attestee],
  //   });
  //   setRes(res as string);
  // };

  const [user, setUser] = useState<string>("");
  const [inviteToken, setInviteToken] = useState<string>("");

  return (
    <>
      <h1>Psibase Demo App 1</h1>
      <pre>{JSON.stringify(res, null, 2)}</pre>

      <div className="card">
        <input type="text" onChange={(e) => setUser(e.target.value)} />
        <button onClick={() => login()}>{"Login"}</button>
      </div>

      {/* 
      // Commenting this out until there's an identity package that can be installed by default
      <h3>Attestation</h3>
      <div>
        <h4>Identity Claim:</h4>
        <div>
          <span>Attestee:</span>
          <input
            id="attestee"
            type="text"
            onChange={(e) => {
              setAttestee(e.target.value);
            }}
            value={attestee}
          />
        </div>
        <div>
          <input
            id="claim"
            type="text"
            onChange={(e) => {
              if (!/^[0-9.]*$/.test(e.target.value)) {
                e.preventDefault();
              } else {
                setClaim(parseFloat(e.target.value));
              }
            }}
            value={claim}
          />
          <button onClick={attestIdentity}> Attest </button>
          <button onClick={getIdentitySummary}> get Summary </button>
        </div>
      </div> */}

      <div className="card">
        <button onClick={() => helloWorld()}>
          {"demoapp1:plugin->helloworld2"}
        </button>
      </div>

      <div className="card">
        <button onClick={() => generateInvite()}>{"Generate invite"}</button>
        <button onClick={() => decodeInvite()}>{"Decode invite"}</button>
      </div>
    </>
  );
}

export default App;

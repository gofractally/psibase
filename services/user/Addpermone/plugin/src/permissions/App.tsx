import { useEffect, useState } from "react";

import { Button } from "@shadcn/button";

import { Nav } from "@components/nav";

import { getSupervisor, siblingUrl } from "@psibase/common-lib";
import { ActivePermsOauthRequest } from "./db";

const supervisor = getSupervisor();

export const App = () => {
  const thisServiceName = "addpermone";
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [params, setParams] = useState<any>({});
  const [validPermRequest, setValidPermRequest] = useState<any>({});
  const [error, setError] = useState<string | null>(null);

  const initApp = async () => {
    const qps = getQueryParams();
    setParams(qps);

    let permReqPayload;
    try {
      permReqPayload = await ActivePermsOauthRequest.get();
      console.log("initApp::permReqPayload", permReqPayload);
    } catch (e) {
      setError("Permissions request error: " + e);
      setIsLoading(false);
      return;
    }

    if (
      !permReqPayload.user ||
      !permReqPayload.caller ||
      !permReqPayload.callee
    ) {
      setError("Invalid permissions request payload: missing fields.");
      setIsLoading(false);
      return;
    }

    setValidPermRequest(permReqPayload);
    setIsLoading(false);
  };

  useEffect(() => {
    initApp();
  }, []);

  const followReturnRedirect = async () => {
    const qps = getQueryParams();
    if (window.top) {
      window.top.location.href = siblingUrl(
        null,
        validPermRequest?.caller,
        qps.returnUrlPath,
        true
      );
    }
  };
  const approve = async () => {
    try {
      console.log("approve::validPermRequest", validPermRequest);
      await supervisor.functionCall({
        service: thisServiceName,
        intf: "admin",
        method: "savePerm",
        params: [
          validPermRequest?.user,
          validPermRequest?.caller,
          validPermRequest?.method,
        ],
      });
      await ActivePermsOauthRequest.delete();
    } catch (e) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Unknown error saving permission");
      }
      throw e;
    }
    followReturnRedirect();
  };
  const deny = async () => {
    try {
      await supervisor.functionCall({
        service: thisServiceName,
        intf: "admin",
        method: "delPerm",
        params: [
          validPermRequest?.user,
          validPermRequest?.caller,
          validPermRequest?.callee,
        ],
      });
      await ActivePermsOauthRequest.delete();
    } catch (e) {
      if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Unknown error deleting permission");
      }
      throw e;
    }
    followReturnRedirect();
  };
  const getQueryParams = () => {
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    return Object.fromEntries(urlParams.entries());
  };

  if (error) {
    return <div>{error}</div>;
  } else if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="mx-auto h-screen w-screen max-w-screen-lg">
      <Nav title="Grant access?" />
      <p>{validPermRequest.prompt}</p>
      {!!error && <div>ERROR: {error}</div>}
      <Button onClick={approve}>Accept</Button>
      <Button onClick={deny}>Deny</Button>
    </div>
  );
};

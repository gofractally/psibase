import { genKeyPair, KeyType } from "@psibase/common-lib";
import { useMutation } from "@tanstack/react-query";
import { Input } from "@toolbox/components/ui";
import { Con } from "components/layouts/con";
import { useUser } from "hooks";
import {
  FractalList,
} from "hooks/useParticipatingFractals";
import { queryClient } from "main";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fractalApplet } from "service";

const appletAddress = async () => {
  const appletName = await fractalApplet.getAppletName();

  const removedSubdomain = window.location.host
    .split(".")
    .filter((text) => text !== appletName)
    .join(".");
  const result = `${window.location.protocol}//${removedSubdomain}/applet/invite-sys`;
  return result;
};

const useCreateFractal = () => {
  const { user } = useUser();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async ({
      name,
      description,
      languageCode,
      displayName,
    }: {
      name: string;
      description?: string;
      languageCode?: string;
      displayName?: string;
    }) => {
      return fractalApplet.createFractal({
        name,
        type: "0",
        ...(description && { description }),
        ...(languageCode && { languageCode }),
        ...(displayName && { displayName }),
      });
    },
    onSuccess: async (_, { name, description, languageCode, displayName }) => {
      console.log("success", {
        _,
        name,
        description,
        languageCode,
        displayName,
      });
      const newFractal: FractalList = {
        inviter: "",
        key: {
          account: user?.participantId,
          fractal: name,
        },
        rewardShares: "0",
      };

      const fractalsKey = ["fractals", user?.participantId];
      queryClient.setQueryData(fractalsKey, (fractals: FractalList[]) => [
        ...fractals,
        newFractal,
      ]);
      queryClient.invalidateQueries(fractalsKey);
      queryClient.setQueryData(["fractal", { name }], {
        account: { name },
        type: "",
        founder: user?.participantId,
        creationTime: new Date().toISOString(),
        displayName: displayName || "",
        description: description || "",
        languageCode: languageCode || "",
        eventHead: "0",
      });
      navigate(`/fractal/${name}/home`);
    },
  });
};

const useCreateInvite = () => {
  return useMutation({
    mutationFn: async (name: string) => {
      const { pub: publicKey, priv } = genKeyPair(KeyType.k1);

      const res = await fractalApplet.createInvite({
        fractalId: name,
        publicKey,
      });

      const token = priv;
      const address = await appletAddress();
      const url = new URL(address);
      url.searchParams.append("token", token);
      url.searchParams.append("ref", "fractal-sys");
      return url.toString();
    },
  });
};

export const CreateFractal = () => {
  const {
    mutate: createFractal,
    isLoading,
    error,
    isSuccess,
  } = useCreateFractal();

  const [name, setName] = useState("");
  const [languageCode, setLangCode] = useState("");
  const [description, setDescription] = useState("");
  const [displayName, setDisplayname] = useState("");

  const [link, setLink] = useState("");

  const { mutateAsync: createInvite } = useCreateInvite();

  const test = async () => {
    const numbers = parseInt((Math.random() * 1000).toString());
    const name = "whatever" + numbers;
    const res = await fractalApplet.createFractal({ name, type: "0" });
    console.log("passed", res);
  };

  return (
    <Con title="Create Fractal">
      <>
        <div className=" max-w-7xl w-full mx-auto">
          <div className="flex mt-8 justify-between">
            Unique name
            <Input
              disabled={isLoading || isSuccess}
              value={name}
              // @ts-ignore
              onChange={(x) => setName(x.target.value)}
            />
          </div>
          <div className="flex mt-8 justify-between">
            Display name
            <Input
              disabled={isLoading || isSuccess}
              value={displayName}
              // @ts-ignore
              onChange={(x) => setDisplayname(x.target.value)}
            />
          </div>
          <div className="flex mt-8 justify-between">
            Description
            <Input
              disabled={isLoading || isSuccess}
              value={description}
              // @ts-ignore
              onChange={(x) => setDescription(x.target.value)}
            />
          </div>
          <div className="flex mt-8 justify-between">
            Language Code
            <Input
              disabled={isLoading || isSuccess}
              value={languageCode}
              // @ts-ignore
              onChange={(x) => setLangCode(x.target.value)}
            />
          </div>
          <div>
            <button
              className="p-4 bg-green-500 w-32 rounded-lg text-white"
              onClick={() => test()}
            >
              Test
            </button>
            <button
              disabled={isLoading || name == ""}
              onClick={() =>
                createFractal({ name, description, languageCode, displayName })
              }
              className="rounded-lg bg-blue-500 text-white p-4 disabled:bg-blue-400"
            >
              {isLoading
                ? "Loading.."
                : isSuccess
                ? "Successful!"
                : "Create Fractal"}
            </button>
          </div>
        </div>
        {isSuccess && (
          <div>
            Create an Invite
            <button
              disabled={isLoading}
              onClick={() => createInvite(name).then(setLink)}
              className="rounded-lg bg-blue-500 text-white p-4"
            >
              Create invite link
            </button>
            <div>Link: {link}</div>
          </div>
        )}
      </>
    </Con>
  );
};

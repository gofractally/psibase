import { useMutation } from "@tanstack/react-query";
import { Input } from "@toolbox/components/ui";
import { genKeyPair, KeyType } from "common/keyConversions.mjs";
import { Con } from "components/layouts/con";
import { useUser } from "hooks";
import { useFractal, fetchFractal } from "hooks/useParticipatingFractals";
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
  // const navigate = useNavigate();

  return useMutation({
    mutationFn: async (name: string) => {
      console.log(name, "is the name");
      await fractalApplet.createFractal({ name, prettyName: name, type: "1" });
    },
    onSuccess: async (_, param) => {
      queryClient.invalidateQueries(["fractals", user?.participantId]);
      const res = await fetchFractal(param);
      console.log(res, "was the res", param);
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
  const [link, setLink] = useState("");

  const { mutate: createInvite } = useMutation({
    async onSuccess({ token }) {
      const address = await appletAddress();
      const url = new URL(address);
      url.searchParams.append("token", token);
      url.searchParams.append("ref", "fractal-sys");
      setLink(url.toString());
    },
    mutationFn: async (name: string) => {
      const { pub: publicKey, priv } = genKeyPair(KeyType.k1);

      const res = await fractalApplet.createInvite({
        fractalId: name,
        publicKey,
      });

      return { token: priv };
    },
  });

  return (
    <Con title="Create Fractal">
      <>
        <div className=" max-w-7xl w-full mx-auto">
          <div className="flex mt-8 justify-between">
            Name of fractal
            <Input
              disabled={isLoading || isSuccess}
              value={name}
              onChange={(x) => setName(x.target.value)}
            />
          </div>
          <div>
            <button
              disabled={isLoading}
              onClick={() => createFractal(name)}
              className="rounded-lg bg-blue-500 text-white p-4"
            >
              {isLoading
                ? "Loading.."
                : isSuccess
                ? "Successful!"
                : "Create Fractal"}
            </button>
            {error && <div className="bg-red-500">{JSON.stringify(error)}</div>}
          </div>
        </div>
        {isSuccess && (
          <div>
            Create an Invite
            <button
              disabled={isLoading}
              onClick={() => createInvite(name)}
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

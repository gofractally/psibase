import { useMutation } from "@tanstack/react-query";
import { Input } from "@toolbox/components/ui";
import { Con } from "components/layouts/con";
import { useUser } from "hooks";
import { useFractal, fetchFractal } from "hooks/useParticipatingFractals";
import { queryClient } from "main";
import React, { useState } from "react";
import { fractalApplet } from "service";

const useCreateFractal = () => {
  const { user } = useUser();

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

  return (
    <Con title="Create Fractal">
      <div className=" max-w-7xl w-full mx-auto">
        <div className="flex mt-8 justify-between">
          Name of fractal
          {/* @ts-ignore */}
          <Input value={name} onChange={(x) => setName(x.target.value)} />
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
    </Con>
  );
};

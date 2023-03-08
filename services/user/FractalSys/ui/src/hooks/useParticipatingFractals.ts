import { mockDelay } from "./mockDelay";
import { useQuery } from "@tanstack/react-query";
import { postGraphQLGetJson } from "common/rpc.mjs";
import { fractals } from "dataDump";

interface FractalListItem {
  id: string;
  name: string;
  image: string;
}

export const useFractal = (fractalId?: string) => {
  return useQuery(
    ["fractal", fractalId],
    mockDelay(fractals.find((x) => x.id === fractalId)!),
    { enabled: !!fractalId }
  );
};

const queryFractal = (name: string): string => `{
    getFractal(name: "${name}") {
      name
      type
      prettyName
      founder
    }
}`;

export const fetchFractal = async (name: string) => {
  const query = queryFractal(name);
  return postGraphQLGetJson<{ data: { derp: string } }>("/graphql", query);
};

export const useParticipatingFractals = (username?: string) => {
  return useQuery(
    ["fractals", username],
    mockDelay<FractalListItem[]>(fractals),
    {
      enabled: !!username,
    }
  );
};

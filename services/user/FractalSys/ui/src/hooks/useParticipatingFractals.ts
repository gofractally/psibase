import { mockDelay } from "./mockDelay";
import { useQuery } from "@tanstack/react-query";
import { postGraphQLGetJson } from "@psibase/common-lib";
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



const queryFractals = (user: string): string => `{
  getFractals(user: "${user}") {
    pageInfo     { hasNextPage  }
    edges {
      node { 
        key { 
          account
          fractal
         }
         inviter
         rewardShares
      }
     }
  }
}`;

interface VectorResponse<T = any> {
  data: {
    [key: string]: {
      edges: {
        node: T
      }[]
    }
  }
}

interface Fractal { inviter: string, rewardShares: string, key: { account: string, fractal: string } }

export const gq = async<T = any>(query: string) => postGraphQLGetJson<T>("/graphql", query);

export const fetchFractal = async (name: string) => gq(queryFractal(name));

export const fetchFractals = async(username: string): Promise<Fractal[]> => {  
  const res = await gq<VectorResponse<Fractal>>(queryFractals(username));
  return res.data.getFractals!.edges.flatMap(edge => edge.node).filter(x => x.key.fractal)
}

export const useParticipatingFractals = (username?: string) => {
  return useQuery(
    ["fractals", username],
    () => fetchFractals(username!),
    {
      enabled: !!username,
    }
  );
};

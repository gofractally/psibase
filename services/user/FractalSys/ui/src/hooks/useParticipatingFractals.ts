import { postGraphQLGetJson } from "@psibase/common-lib";
import { useQuery } from "@tanstack/react-query";

export const useFractal = (fractalId?: string) => {
  return useQuery(["fractal", fractalId], () => fetchFractal(fractalId), {
    enabled: !!fractalId,
  });
};

const queryFractal = (name: string): string => `{
  
    getFractal(fractal: "${name}") {
      account
      type
      founder
      creationTime
      displayName
      description
      languageCode
      eventHead
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
        node: T;
      }[];
    };
  };
}

export interface FractalList {
  inviter: string;
  rewardShares: string;
  key: { account: string; fractal: string };
}
interface FractalDetail {
  account: string;
  type: string;
  founder: string;
  creationTime: string;
  displayName: string;
  description: string;
  launguageCode: string;
  eventHead: string;
}

export const gq = async <T = any>(query: string) =>
  postGraphQLGetJson<T>("/graphql", query);

export const fetchFractal = async (name: string) => {
  const res = await gq<{ data: { getFractal: FractalDetail } }>(
    queryFractal(name)
  );
  return res.data.getFractal;
};

export const fetchFractals = async (
  username: string
): Promise<FractalList[]> => {
  const res = await gq<VectorResponse<FractalList>>(queryFractals(username));
  return res.data
    .getFractals!.edges.flatMap((edge) => edge.node)
    .filter((x) => x.key.fractal);
};

export const useParticipatingFractals = (username?: string) => {
  return useQuery(["fractals", username], () => fetchFractals(username!), {
    enabled: !!username,
  });
};

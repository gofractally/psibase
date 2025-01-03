import { siblingUrl } from "@psibase/common-lib";

interface Error {
  message: string;
  locations: {
    line: number;
    column: number;
  }[];
}

interface GraphqlResponse<T> {
  data: T;
  errors?: Error[];
}

export const graphql = async <T>(
  query: string,
  service?: string
): Promise<T> => {
  const response = (await fetch(
    `${service ? siblingUrl(null, service) : ""}/graphql`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }
  ).then((x) => x.json())) as GraphqlResponse<T>;

  if (response.errors) {
    throw new Error(response.errors[0].message);
  }
  return response.data;
};

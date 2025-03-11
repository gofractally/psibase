import { Account } from "@/lib/zod/Account";
import { siblingUrl } from "@psibase/common-lib";
import { z } from "zod";

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
  service: z.infer<typeof Account>
): Promise<T> => {
  const response = (await fetch(
    siblingUrl(null, Account.parse(service), 'graphql', false),
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

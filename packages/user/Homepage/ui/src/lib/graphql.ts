import { z } from "zod";

import { siblingUrl } from "@psibase/common-lib";

import { zAccount } from "@/lib/zod/Account";

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
    service: z.infer<typeof zAccount>,
): Promise<T> => {
    const response = (await fetch(
        siblingUrl(null, zAccount.parse(service), "graphql", false),
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
        },
    ).then((x) => x.json())) as GraphqlResponse<T>;

    if (response.errors) {
        throw new Error(response.errors[0].message);
    }
    return response.data;
};

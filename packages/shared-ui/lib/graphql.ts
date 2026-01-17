import { siblingUrl } from "@psibase/common-lib";

import { Account, zAccount } from "@shared/lib/schemas/account";

interface Error {
    message: string;
    locations: {
        line: number;
        column: number;
    }[];
}

const gqlEndpoint = (account: Account, includesSibling: boolean) =>
    siblingUrl(null, zAccount.parse(account), "/graphql", includesSibling);

interface GraphqlResponse<T> {
    data: T;
    errors?: Error[];
}

export const graphql = async <T>(
    query: string,
    service: Account,
    includesSibling = true,
): Promise<T> => {
    const response = (await fetch(gqlEndpoint(service, includesSibling), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    }).then((x) => x.json())) as GraphqlResponse<T>;

    if (response.errors) {
        throw new Error(response.errors[0].message);
    }
    return response.data;
};

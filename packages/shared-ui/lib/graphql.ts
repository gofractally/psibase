import { siblingUrl } from "@psibase/common-lib";

interface Error {
    message: string;
    locations: {
        line: number;
        column: number;
    }[];
}

export type GraphQLUrlOptions = {
    baseUrl?: string | null;
    service?: string | null;
    path?: string | null;
    baseUrlIncludesSibling?: boolean;
};

interface GraphqlResponse<T> {
    data: T;
    errors?: Error[];
}

export const graphql = async <T>(
    query: string,
    options: GraphQLUrlOptions = {},
): Promise<T> => {
    const { baseUrl, service, path, baseUrlIncludesSibling } = options;
    const host = service
        ? siblingUrl(baseUrl, service, path, baseUrlIncludesSibling)
        : "";
    const response = (await fetch(`${host}/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    }).then((x) => x.json())) as GraphqlResponse<T>;

    if (response.errors) {
        throw new Error(response.errors[0].message);
    }
    return response.data;
};

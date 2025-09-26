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

export const graphql = async <T>(query: string, url?: string): Promise<T> => {
    const response = (await fetch(
        url || siblingUrl(undefined, "fractals", "/graphql"),
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

import { postGraphQLGetJson, siblingUrl } from "@psibase/common-lib"


export const graphql = async (query: string, service: string) => postGraphQLGetJson(
    siblingUrl(undefined, service, "/graphql"),
    query
)


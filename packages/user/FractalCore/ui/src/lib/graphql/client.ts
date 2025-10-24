import { GraphQLClient } from "graphql-request";

import { siblingUrl } from "@psibase/common-lib";

export const client = new GraphQLClient(
    siblingUrl(null, "fractals", "/graphql"),
);

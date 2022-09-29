import { AppletId, postGraphQLGetJson, query } from "common/rpc.mjs";
import wait from "waait";
import { Counter } from "./App";

const accountSys = new AppletId("account-sys");

export const getLoggedInUser = () => query<void, string>(accountSys, "getLoggedInUser");

export const fetchTable = async (previousCount?: number): Promise<number> => {
    const queryResult = await postGraphQLGetJson(
        "/graphql",
        `
        {
            counter {
              edges {
                node {
                  counter
                }
              }
            }
          }`
    ) as Counter
    const newCount = queryResult.data.counter.edges[0].node.counter;
    if (typeof previousCount === 'number' && newCount === previousCount) {
        await wait(500)
        return fetchTable(previousCount)
    } else {
        return newCount
    }
}
import { AppletId, postGraphQLGetJson, query } from "common/rpc.mjs";

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
interface Counter {
    data: Data;
}

interface Data {
    counter: CounterClass;
}

interface CounterClass {
    edges: Edge[];
}

interface Edge {
    node: Node;
}

interface Node {
    counter: number;
}


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
    const edges = queryResult.data.counter.edges;
    if (edges.length === 0) return 0;
    const newCount = edges[0].node.counter;
    if (typeof previousCount === 'number' && newCount === previousCount) {
        await wait(500)
        return fetchTable(previousCount)
    } else {
        return newCount
    }
}
import { getJson } from "/common/rpc.mjs?client";
import {
    useGraphQLPagedQuery,
    useGraphQLQuery,
} from "./useGraphQLQuery.mjs?client";

const GraphQLPageQuery = `
{
    blocks(@page@) {
        pageInfo {
            hasPreviousPage
            hasNextPage
            startCursor
            endCursor
        }
        edges {
            node {
                header {
                    blockNum
                    previous
                    time
                }
                transactions {
                }
            }
        }
    }
}`;

function decodeArgs(args) {
    return args
        .replace("?", "")
        .replaceAll("=", ":")
        .replaceAll("&", " ")
        .replaceAll("%22", "\"");
}

export async function loadData(args) {
    try {
        const query = GraphQLPageQuery.replace("@page@", decodeArgs(args));
        const pagedResult = await useGraphQLPagedQuery("/graphql", query, {
            pageSize: 50,
            getPageInfo: (result) => result.data.blocks.pageInfo,
            defaultArgs: "last:50",
        });
        // console.log("loadData pagedResult:", args, pagedResult);
        const edges = args.includes("first=50")
            ? pagedResult.result.data.blocks.edges
            : pagedResult.result.data.blocks.edges.reverse();
        const blocks = edges.map((e) => {
            // if (e.node.transactions.length > 0) {
            //     console.log(
            //         "Trx block",
            //         e.node.header.blockNum,
            //         e.node.transactions.length
            //     );
            // }
            return e.node;
        });
        return {
            blocks,
            pagedResult,
        };
    } catch (error) {
        console.error("Error in loadData :", error);
        return {
            error,
        };
    }
}

const GraphQLBlockQuery = `
{
  blocks(ge: @block@, le: @block@) {
    edges {
      node {
        header {
          blockNum,
          previous,
          time
        }
        transactions {
          transaction {
            actions {
              sender
              service
              method
            }
          }
        }
      }
    }
  }
}`;

export async function loadBlockData(blockNum) {
    try {
        // console.log("loadBlocksData args:", blockNum);
        const query = GraphQLBlockQuery.replaceAll("@block@", blockNum);
        const result = await useGraphQLQuery("/graphql", query);
        const e = result.data.blocks.edges[0];
        // if (e.node.transactions.length > 0) {
        //     console.log("Trx block", e.node.header.blockNum, e.node.transactions.length);
        // }
        const transactions = e.node.transactions.map((t) => t.transaction);
        // console.log("loadBlocksData result:", result);
        return {
            block: e.node.header,
            transactions,
        };
    } catch (error) {
        console.error("Error in loadBlockData :", error);
        return {
            error,
        };
    }
}

function queryTransferHistory(account) {
    return `{
      holderEvents(holder: "${account}") {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            event_id
            event_type
            event_all_content
          }
        }
      }
    }`;
}

export async function loadTransferHistory(account) {
    const query = queryTransferHistory(account);
    const host = window.location.host.replace("explore-sys.", "token-sys.");
    const url = `${window.location.protocol}//${host}/graphql`;
    const result = await useGraphQLQuery(url, query);
    return result;
}

export async function getAccountsByKey(pubKey) {
    try {
        const host = window.location.host.replace(
            "explore-sys.",
            "auth-ec-sys."
        );
        const url = `${window.location.protocol}//${host}/accwithkey/${pubKey}`;
        const result = await getJson(url);
        return result;
    } catch (error) {
        console.error("Error in getAccountsByKey :", error);
        return {
            error,
        };
    }
}

export async function getPubKeyByAccountName(account) {
    try {
        const host = window.location.host.replace(
            "explore-sys.",
            "auth-ec-sys."
        );
        const url = `${window.location.protocol}//${host}/account/${account}`;
        const result = await getJson(url);
        return result;
    } catch (error) {
        console.error("Error in getPubKeyByAccountName :", error);
        return {
            error,
        };
    }
}

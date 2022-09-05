import { AppletId, query } from "common/rpc.mjs";
import { useGraphQLQuery } from "common/useGraphQLQuery.mjs";

import { tokenContract } from "./contracts";
import { wait } from "./helpers";
import { TokenBalance } from "./types";

const accountSys = new AppletId("account-sys", "");

export const getLoggedInUser = () => {
    return query<void, string>(accountSys, "getLoggedInUser");
};

export const getTokens = async (user: string) => {
    return tokenContract.fetchBalances(user);
};

export const pollForBalanceChange = async (
    user: string,
    prevToken: TokenBalance,
    attempt = 1
): Promise<TokenBalance[]> => {
    const tokens = await tokenContract.fetchBalances(user);
    const newToken = tokens.find((t) => t.token === prevToken.token);

    if (!newToken) throw new Error("Updated token not found.");

    const maxAttempts = 5;
    const tooManyAttempts = attempt > maxAttempts;

    if (tooManyAttempts) {
        throw new Error(`No balance change detected after ${maxAttempts}.`);
    }

    if (newToken.balance !== prevToken.balance) {
        return tokens;
    }

    console.log(`Checking for updated balance; Attempt: ${attempt}.`);
    await wait(500);
    return pollForBalanceChange(user, prevToken, attempt + 1);
};

const queryTransferHistory = (holder: string) => `{
  holderEvents(holder: "${holder}") {
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

export const useTransferHistory = (user?: string) => {
    const query = user && queryTransferHistory(user);
    return useGraphQLQuery("/graphql", query);
};

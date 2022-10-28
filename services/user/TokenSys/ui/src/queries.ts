import { AppletId, query } from "common/rpc.mjs";
import { useGraphQLQuery } from "common/useGraphQLQuery.mjs";

import { TokenBalance, TokenMeta } from "./types";

/*********************
 * IAC Queries
 *********************/
export const getLoggedInUser = () => {
    const accountSys = new AppletId("account-sys", "");
    return query<void, string>(accountSys, "getLoggedInUser");
};

/*********************
 * GraphQL Queries
 *********************/
export const queryUserConf = (user: string, flag: string) => `{
  userConf(user: "${user}", flag: "${flag}")
}`;

const queryTransferHistory = (user: string) => `{
  userEvents(user: "${user}") {
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

export const queryTokens = `{
  tokenTypes {
    edges {
      node {
        id
        precision {
          value
        }
        symbolId
      }
    }
  }
}`;

export const queryUserBalances = (user: string) => `{
  userBalances(user: "${user}") {
    user
    balance
    precision
    token
    symbol
  }
}`;

const querySharedBalances = () => `{
  sharedBalances(last:1000) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        balance
        key {
          creditor
          debitor
          tokenId
        }
      }
    }
  }
}`;

/*********************
 * GraphQL Query Hooks
 *********************/
export const useUserDebitModeConf = (user?: string) => {
    const query = user && queryUserConf(user, "manualDebit");
    return useGraphQLQuery("/graphql", query);
};

export const useTransferHistory = (user?: string) => {
    const query = user && queryTransferHistory(user);
    return useGraphQLQuery("/graphql", query);
};

export const useUserBalances = (user?: string) => {
    const query = user && queryUserBalances(user);
    return useGraphQLQuery("/graphql", query);
};

export const useSharedBalances = () => {
    // TODO: it should only query user's balances when backend supports this functionality
    const query = querySharedBalances();
    return useGraphQLQuery("/graphql", query);
};

/*********************
 * Related Types
 *********************/
export interface GqlResponse<T> {
    data: T;
}

export interface TokensGqlResponse {
    data: {
        tokenTypes: {
            edges: {
                node: TokenMeta;
            }[];
        };
    };
}

export interface UserBalancesGqlResponse {
    data: {
        userBalances: TokenBalance[];
    };
}

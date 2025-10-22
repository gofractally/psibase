import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
import * as ApolloReactHooks from '@apollo/client/react';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
const defaultOptions = {} as const;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  AccountNumber: { input: any; output: any; }
  Memo: { input: any; output: any; }
  TimePointSec: { input: any; output: any; }
};

export type EvaluationFinish = {
  __typename?: 'EvaluationFinish';
  evaluationId: Scalars['Int']['output'];
  fractal: Scalars['AccountNumber']['output'];
  guild: Scalars['AccountNumber']['output'];
};

export type EvaluationFinishConnection = {
  __typename?: 'EvaluationFinishConnection';
  /** A list of edges. */
  edges: Array<EvaluationFinishEdge>;
  /** A list of nodes. */
  nodes: Array<EvaluationFinish>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
};

/** An edge in a connection. */
export type EvaluationFinishEdge = {
  __typename?: 'EvaluationFinishEdge';
  /** A cursor for use in pagination */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge */
  node: EvaluationFinish;
};

export type EvaluationInstance = {
  __typename?: 'EvaluationInstance';
  evaluationId: Scalars['Int']['output'];
  guild: Scalars['AccountNumber']['output'];
  guildInstance: Guild;
  interval: Scalars['Int']['output'];
};

export type Fractal = {
  __typename?: 'Fractal';
  account: Scalars['AccountNumber']['output'];
  createdAt: Scalars['TimePointSec']['output'];
  memberships: Array<FractalMember>;
  mission: Scalars['String']['output'];
  name: Scalars['String']['output'];
};

export type FractalConnection = {
  __typename?: 'FractalConnection';
  /** A list of edges. */
  edges: Array<FractalEdge>;
  /** A list of nodes. */
  nodes: Array<Fractal>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
};

/** An edge in a connection. */
export type FractalEdge = {
  __typename?: 'FractalEdge';
  /** A cursor for use in pagination */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge */
  node: Fractal;
};

export type FractalMember = {
  __typename?: 'FractalMember';
  account: Scalars['AccountNumber']['output'];
  createdAt: Scalars['TimePointSec']['output'];
  fractal: Scalars['AccountNumber']['output'];
  fractalDetails: Fractal;
  memberStatus: Scalars['Int']['output'];
};

export type FractalMemberConnection = {
  __typename?: 'FractalMemberConnection';
  /** A list of edges. */
  edges: Array<FractalMemberEdge>;
  /** A list of nodes. */
  nodes: Array<FractalMember>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
};

/** An edge in a connection. */
export type FractalMemberEdge = {
  __typename?: 'FractalMemberEdge';
  /** A cursor for use in pagination */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge */
  node: FractalMember;
};

export type GroupFinish = {
  __typename?: 'GroupFinish';
  evaluationId: Scalars['Int']['output'];
  groupNumber: Scalars['Int']['output'];
  result: Array<Scalars['AccountNumber']['output']>;
  users: Array<Scalars['AccountNumber']['output']>;
};

export type GroupFinishConnection = {
  __typename?: 'GroupFinishConnection';
  /** A list of edges. */
  edges: Array<GroupFinishEdge>;
  /** A list of nodes. */
  nodes: Array<GroupFinish>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
};

/** An edge in a connection. */
export type GroupFinishEdge = {
  __typename?: 'GroupFinishEdge';
  /** A cursor for use in pagination */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge */
  node: GroupFinish;
};

export type Guild = {
  __typename?: 'Guild';
  account: Scalars['AccountNumber']['output'];
  bio: Scalars['Memo']['output'];
  council: Array<Scalars['AccountNumber']['output']>;
  description: Scalars['String']['output'];
  displayName: Scalars['Memo']['output'];
  evalInstance?: Maybe<EvaluationInstance>;
  fractal: Fractal;
  rep?: Maybe<GuildMember>;
};

export type GuildApplication = {
  __typename?: 'GuildApplication';
  attestations: Array<GuildAttest>;
  createdAt: Scalars['TimePointSec']['output'];
  extraInfo: Scalars['String']['output'];
  guild: Guild;
  member: Scalars['AccountNumber']['output'];
};

export type GuildApplicationConnection = {
  __typename?: 'GuildApplicationConnection';
  /** A list of edges. */
  edges: Array<GuildApplicationEdge>;
  /** A list of nodes. */
  nodes: Array<GuildApplication>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
};

/** An edge in a connection. */
export type GuildApplicationEdge = {
  __typename?: 'GuildApplicationEdge';
  /** A cursor for use in pagination */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge */
  node: GuildApplication;
};

export type GuildAttest = {
  __typename?: 'GuildAttest';
  attestee: Scalars['AccountNumber']['output'];
  comment: Scalars['String']['output'];
  endorses: Scalars['Boolean']['output'];
  guild: Guild;
  member: Scalars['AccountNumber']['output'];
};

export type GuildConnection = {
  __typename?: 'GuildConnection';
  /** A list of edges. */
  edges: Array<GuildEdge>;
  /** A list of nodes. */
  nodes: Array<Guild>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
};

/** An edge in a connection. */
export type GuildEdge = {
  __typename?: 'GuildEdge';
  /** A cursor for use in pagination */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge */
  node: Guild;
};

export type GuildMember = {
  __typename?: 'GuildMember';
  createdAt: Scalars['TimePointSec']['output'];
  guild: Guild;
  member: Scalars['AccountNumber']['output'];
  pendingScore?: Maybe<Scalars['Int']['output']>;
  score: Scalars['Int']['output'];
};

export type GuildMemberConnection = {
  __typename?: 'GuildMemberConnection';
  /** A list of edges. */
  edges: Array<GuildMemberEdge>;
  /** A list of nodes. */
  nodes: Array<GuildMember>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
};

/** An edge in a connection. */
export type GuildMemberEdge = {
  __typename?: 'GuildMemberEdge';
  /** A cursor for use in pagination */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge */
  node: GuildMember;
};

export type NewGroup = {
  __typename?: 'NewGroup';
  evaluationId: Scalars['Int']['output'];
  groupNumber: Scalars['Int']['output'];
  owner: Scalars['AccountNumber']['output'];
  users: Array<Scalars['AccountNumber']['output']>;
};

export type NewGroupConnection = {
  __typename?: 'NewGroupConnection';
  /** A list of edges. */
  edges: Array<NewGroupEdge>;
  /** A list of nodes. */
  nodes: Array<NewGroup>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
};

/** An edge in a connection. */
export type NewGroupEdge = {
  __typename?: 'NewGroupEdge';
  /** A cursor for use in pagination */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge */
  node: NewGroup;
};

/** Information about pagination in a connection */
export type PageInfo = {
  __typename?: 'PageInfo';
  /** When paginating forwards, the cursor to continue. */
  endCursor?: Maybe<Scalars['String']['output']>;
  /** When paginating forwards, are there more items? */
  hasNextPage: Scalars['Boolean']['output'];
  /** When paginating backwards, are there more items? */
  hasPreviousPage: Scalars['Boolean']['output'];
  /** When paginating backwards, the cursor to continue. */
  startCursor?: Maybe<Scalars['String']['output']>;
};

export type Query = {
  __typename?: 'Query';
  evalById?: Maybe<EvaluationInstance>;
  evaluationFinishes: EvaluationFinishConnection;
  fractal?: Maybe<Fractal>;
  fractals: FractalConnection;
  fractalsList: Array<Maybe<Fractal>>;
  getGroupsCreated: NewGroupConnection;
  groupFinishes: GroupFinishConnection;
  guild?: Maybe<Guild>;
  guildApplication?: Maybe<GuildApplication>;
  guildApplications: GuildApplicationConnection;
  guildMemberships: GuildMemberConnection;
  guilds: GuildConnection;
  member?: Maybe<FractalMember>;
  members: FractalMemberConnection;
  memberships: FractalMemberConnection;
  scheduledEvaluations: ScheduledEvaluationConnection;
  scoreByMember?: Maybe<GuildMember>;
  scores: GuildMemberConnection;
};


export type QueryEvalByIdArgs = {
  evaluationId: Scalars['Int']['input'];
};


export type QueryEvaluationFinishesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  guild: Scalars['AccountNumber']['input'];
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryFractalArgs = {
  fractal: Scalars['AccountNumber']['input'];
};


export type QueryFractalsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryFractalsListArgs = {
  fractals: Array<Scalars['AccountNumber']['input']>;
};


export type QueryGetGroupsCreatedArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  evaluationId: Scalars['Int']['input'];
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryGroupFinishesArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  evaluationId: Scalars['Int']['input'];
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryGuildArgs = {
  guild: Scalars['AccountNumber']['input'];
};


export type QueryGuildApplicationArgs = {
  guild: Scalars['AccountNumber']['input'];
  member: Scalars['AccountNumber']['input'];
};


export type QueryGuildApplicationsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  guild: Scalars['AccountNumber']['input'];
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryGuildMembershipsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  member: Scalars['AccountNumber']['input'];
};


export type QueryGuildsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  fractal: Scalars['AccountNumber']['input'];
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryMemberArgs = {
  fractal: Scalars['AccountNumber']['input'];
  member: Scalars['AccountNumber']['input'];
};


export type QueryMembersArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  fractal: Scalars['AccountNumber']['input'];
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryMembershipsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  last?: InputMaybe<Scalars['Int']['input']>;
  member: Scalars['AccountNumber']['input'];
};


export type QueryScheduledEvaluationsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  guild: Scalars['AccountNumber']['input'];
  last?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryScoreByMemberArgs = {
  guild: Scalars['AccountNumber']['input'];
  member: Scalars['AccountNumber']['input'];
};


export type QueryScoresArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  before?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  guild: Scalars['AccountNumber']['input'];
  last?: InputMaybe<Scalars['Int']['input']>;
};

export type ScheduledEvaluation = {
  __typename?: 'ScheduledEvaluation';
  deliberation: Scalars['Int']['output'];
  evaluationId: Scalars['Int']['output'];
  finishBy: Scalars['Int']['output'];
  fractal: Scalars['AccountNumber']['output'];
  guild: Scalars['AccountNumber']['output'];
  registration: Scalars['Int']['output'];
  submission: Scalars['Int']['output'];
};

export type ScheduledEvaluationConnection = {
  __typename?: 'ScheduledEvaluationConnection';
  /** A list of edges. */
  edges: Array<ScheduledEvaluationEdge>;
  /** A list of nodes. */
  nodes: Array<ScheduledEvaluation>;
  /** Information to aid in pagination. */
  pageInfo: PageInfo;
};

/** An edge in a connection. */
export type ScheduledEvaluationEdge = {
  __typename?: 'ScheduledEvaluationEdge';
  /** A cursor for use in pagination */
  cursor: Scalars['String']['output'];
  /** The item at the end of the edge */
  node: ScheduledEvaluation;
};

export type GetFractalQueryVariables = Exact<{
  fractalAccount: Scalars['AccountNumber']['input'];
}>;


export type GetFractalQuery = { __typename?: 'Query', fractal?: { __typename?: 'Fractal', account: any, createdAt: any } | null };

export type GetFractalGuildQueryVariables = Exact<{
  fractal: Scalars['AccountNumber']['input'];
}>;


export type GetFractalGuildQuery = { __typename?: 'Query', fractal?: { __typename?: 'Fractal', account: any, createdAt: any, mission: string, name: string } | null, guilds: { __typename?: 'GuildConnection', nodes: Array<{ __typename?: 'Guild', account: any, displayName: any, council: Array<any>, bio: any, rep?: { __typename?: 'GuildMember', member: any } | null, evalInstance?: { __typename?: 'EvaluationInstance', evaluationId: number } | null }> } };

export type GetFractalsQueryVariables = Exact<{ [key: string]: never; }>;


export type GetFractalsQuery = { __typename?: 'Query', fractals: { __typename?: 'FractalConnection', nodes: Array<{ __typename?: 'Fractal', account: any, name: string, mission: string }> } };


export const GetFractalDocument = gql`
    query GetFractal($fractalAccount: AccountNumber!) {
  fractal(fractal: $fractalAccount) {
    account
    createdAt
  }
}
    `;

/**
 * __useGetFractalQuery__
 *
 * To run a query within a React component, call `useGetFractalQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetFractalQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetFractalQuery({
 *   variables: {
 *      fractalAccount: // value for 'fractalAccount'
 *   },
 * });
 */
export function useGetFractalQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetFractalQuery, GetFractalQueryVariables> & ({ variables: GetFractalQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetFractalQuery, GetFractalQueryVariables>(GetFractalDocument, options);
      }
export function useGetFractalLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetFractalQuery, GetFractalQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetFractalQuery, GetFractalQueryVariables>(GetFractalDocument, options);
        }
export function useGetFractalSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetFractalQuery, GetFractalQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetFractalQuery, GetFractalQueryVariables>(GetFractalDocument, options);
        }
export type GetFractalQueryHookResult = ReturnType<typeof useGetFractalQuery>;
export type GetFractalLazyQueryHookResult = ReturnType<typeof useGetFractalLazyQuery>;
export type GetFractalSuspenseQueryHookResult = ReturnType<typeof useGetFractalSuspenseQuery>;
export type GetFractalQueryResult = Apollo.QueryResult<GetFractalQuery, GetFractalQueryVariables>;
export const GetFractalGuildDocument = gql`
    query GetFractalGuild($fractal: AccountNumber!) {
  fractal(fractal: $fractal) {
    account
    createdAt
    mission
    name
  }
  guilds(fractal: $fractal) {
    nodes {
      account
      rep {
        member
      }
      displayName
      council
      bio
      evalInstance {
        evaluationId
      }
    }
  }
}
    `;

/**
 * __useGetFractalGuildQuery__
 *
 * To run a query within a React component, call `useGetFractalGuildQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetFractalGuildQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetFractalGuildQuery({
 *   variables: {
 *      fractal: // value for 'fractal'
 *   },
 * });
 */
export function useGetFractalGuildQuery(baseOptions: ApolloReactHooks.QueryHookOptions<GetFractalGuildQuery, GetFractalGuildQueryVariables> & ({ variables: GetFractalGuildQueryVariables; skip?: boolean; } | { skip: boolean; }) ) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetFractalGuildQuery, GetFractalGuildQueryVariables>(GetFractalGuildDocument, options);
      }
export function useGetFractalGuildLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetFractalGuildQuery, GetFractalGuildQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetFractalGuildQuery, GetFractalGuildQueryVariables>(GetFractalGuildDocument, options);
        }
export function useGetFractalGuildSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetFractalGuildQuery, GetFractalGuildQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetFractalGuildQuery, GetFractalGuildQueryVariables>(GetFractalGuildDocument, options);
        }
export type GetFractalGuildQueryHookResult = ReturnType<typeof useGetFractalGuildQuery>;
export type GetFractalGuildLazyQueryHookResult = ReturnType<typeof useGetFractalGuildLazyQuery>;
export type GetFractalGuildSuspenseQueryHookResult = ReturnType<typeof useGetFractalGuildSuspenseQuery>;
export type GetFractalGuildQueryResult = Apollo.QueryResult<GetFractalGuildQuery, GetFractalGuildQueryVariables>;
export const GetFractalsDocument = gql`
    query GetFractals {
  fractals {
    nodes {
      account
      name
      mission
    }
  }
}
    `;

/**
 * __useGetFractalsQuery__
 *
 * To run a query within a React component, call `useGetFractalsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetFractalsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetFractalsQuery({
 *   variables: {
 *   },
 * });
 */
export function useGetFractalsQuery(baseOptions?: ApolloReactHooks.QueryHookOptions<GetFractalsQuery, GetFractalsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return ApolloReactHooks.useQuery<GetFractalsQuery, GetFractalsQueryVariables>(GetFractalsDocument, options);
      }
export function useGetFractalsLazyQuery(baseOptions?: ApolloReactHooks.LazyQueryHookOptions<GetFractalsQuery, GetFractalsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useLazyQuery<GetFractalsQuery, GetFractalsQueryVariables>(GetFractalsDocument, options);
        }
export function useGetFractalsSuspenseQuery(baseOptions?: ApolloReactHooks.SkipToken | ApolloReactHooks.SuspenseQueryHookOptions<GetFractalsQuery, GetFractalsQueryVariables>) {
          const options = baseOptions === ApolloReactHooks.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return ApolloReactHooks.useSuspenseQuery<GetFractalsQuery, GetFractalsQueryVariables>(GetFractalsDocument, options);
        }
export type GetFractalsQueryHookResult = ReturnType<typeof useGetFractalsQuery>;
export type GetFractalsLazyQueryHookResult = ReturnType<typeof useGetFractalsLazyQuery>;
export type GetFractalsSuspenseQueryHookResult = ReturnType<typeof useGetFractalsSuspenseQuery>;
export type GetFractalsQueryResult = Apollo.QueryResult<GetFractalsQuery, GetFractalsQueryVariables>;
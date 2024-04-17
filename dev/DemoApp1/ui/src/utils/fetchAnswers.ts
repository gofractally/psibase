const answerStr = (account: string = "alice") => `
{
  answer(account: "${account}") {
    __typename
  result
    id
  }
}
`;

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

const graphql = async <T>(query: string): Promise<T> => {
  const response = (await fetch("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  }).then((x) => x.json())) as GraphqlResponse<T>;

  if (response.errors) {
    throw new Error(response.errors[0].message);
  }
  return response.data;
};

export const fetchAnswers = () =>
  graphql<{ answer: { __typename: string; result: number; id: string } }>(
    answerStr()
  );

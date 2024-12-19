import { useQuery } from "@tanstack/react-query";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

import axios from "axios";
import { siblingUrl } from "@psibase/common-lib";
import { useLoggedInUser } from "./hooks/useLoggedInUser";
import { useCreateConnectionToken } from "./hooks/useCreateConnectionToken";

dayjs.extend(relativeTime);

// const wait = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

const useAccountLookup = (accountName: string | undefined | null) =>
  useQuery({
    queryKey: ["account", accountName],
    queryFn: async () => {
      const url = siblingUrl();
      console.log(url, "is the url");
      return axios.post(siblingUrl());
    },
    enabled: !!accountName,
  });

export const AccountSelection = () => {
  const { data: currentUser } = useLoggedInUser();

  console.log({ currentUser });

  const { mutate: createConnectionToken } = useCreateConnectionToken();

  const { data } = useAccountLookup(currentUser);

  return (
    <div>
      <button
        onClick={() => {
          createConnectionToken();
        }}
      >
        Login
      </button>
      <div>current user is {currentUser}</div>
      {JSON.stringify(data)}
    </div>
  );
};

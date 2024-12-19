import { useQuery } from "@tanstack/react-query";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

// import axios from "axios";
// import { siblingUrl } from "@psibase/common-lib";
import { useLoggedInUser } from "./hooks/useLoggedInUser";
import { useCreateConnectionToken } from "./hooks/useCreateConnectionToken";
import { graphql } from "./lib/graphql";

dayjs.extend(relativeTime);

// http://auth-sig.psibase.127.0.0.1.sslip.io:8080/graphql

// const wait = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

const useAccountLookup = (accountName: string | undefined | null) =>
  useQuery({
    queryKey: ["account", accountName],
    queryFn: async () =>
      graphql(`{
      	account(name: "${accountName}") {
      		pubkey
      		account
        }
      }`),
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
      <div>
        current user is <span className="text-blue-500">{currentUser}</span>
      </div>
      {JSON.stringify(data)}
    </div>
  );
};

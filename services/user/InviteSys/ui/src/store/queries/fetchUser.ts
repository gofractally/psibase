import { AppletId, query, operation } from "common/rpc.mjs";

export const fetchUser = async (): Promise<string> => {
  const accountSys = new AppletId("account-sys");
  const getLoggedInUser = () =>
    query<void, string>(accountSys, "getLoggedInUser");

  const user = (await getLoggedInUser()) as string;
  return user;
};

export const fetchAvailableUsers = async (): Promise<string[]> => {
  const accountSys = new AppletId("account-sys");
  const users = await query<void, string[]>(accountSys, "getKeyStoreAccounts");
  return users;
};

export const addAccount = async (
  accountNum: string,
  keyPair: { privateKey: string; publicKey: string }
): Promise<void> => {
  const accountSys = new AppletId("account-sys", "");
  console.log("trying to add account...", { accountNum, keyPair });
  const res = await operation(accountSys, "addAccount", {
    accountNum,
    keyPair,
  });
  return res;
};

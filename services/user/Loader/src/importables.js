import { connectToParent } from "penpal";

export async function funccall(params) {
  console.log(params, "are received params in importables...");
  return "yesbuddeh funcCall";
}

export function getLoggedInUser() {
  console.log("I WAS ASKED FOR ALICE");
  return "alice";
}

export async function prnt(string) {
  console.log(`from imported code:`, string);

  const xx = await connectToParent().promise;
  const toCall = {
    service: "idunno",
    method: "stilldontknow",
    params: "yesbuddeh",
  };

  const res = await xx.functionCall(toCall);
  console.log(res, "came back from the imported call...");
}

export async function addToTx(params) {
  console.log("addedToTx", params);

  const connection = await connectToParent().promise;
  await connection.addToTx(params);
}

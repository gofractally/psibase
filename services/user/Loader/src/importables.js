import { connectToParent } from "penpal";

function derp(num) {
  return num * 2;
}

export async function funccall(params) {
  console.log(params, "are received params in importables...");
  return "yesbuddeh funcCall";
}

export async function prnt(string) {
  console.log(window, window.postMessage, "was the window post message");
  console.log(`from imported code: ${derp(2)}`, string);

  console.log(connectToParent, "is the connect to parent");

  const xx = await connectToParent().promise;

  console.log(xx, "received in rust..");

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

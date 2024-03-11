export async function funccall(params) {
  return "funcCall";
}

export function getLoggedInUser() {
  return "alice";
}

export async function prnt(string) {
  console.log(`from imported code:`, string);

  const toCall = {
    service: "idunno",
    method: "stilldontknow",
    params: "yesbuddeh",
  };
}

export async function addToTx(params) {
  console.log("addedToTx", params);
}

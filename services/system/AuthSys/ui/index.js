import htm from "/common/htm.module.js";
import {
  initializeApplet,
  getJson,
  setOperations,
  setQueries,
  postGraphQLGetJson,
  uint8ArrayToHex,
  publicStringToDER,
} from "/common/common-lib.js";

const html = htm.bind(React.createElement);

await initializeApplet(async () => {
  setOperations([]),
    setQueries([
      {
        id: "accWithKey",
        exec: async ({ key }) => {
          if (!key) {
            throw new Error("No key provided");
          }

          const queryResult = await postGraphQLGetJson(
            "/graphql",
            `{
              accWithKey(key: "${key}") {
                edges {
                  node {
                    account
                    pubkey
                  }
                }
               }
             }`
          );

          const edges = queryResult?.data?.accWithKey?.edges || [];
          const accounts = edges.map((edge) => ({
            ...edge.node,
          }));
          return accounts;
        },
      },

      {
        id: "getClaim",
        exec: async ({ sender }) => {
          if (!sender) {
            throw new Error("No sender provided");
          }

          console.info("getting claim for sender >>>", sender);

          const queryResult = await postGraphQLGetJson(
            "/graphql",
            `{
               account(name: "${sender}") {
                 account
                 pubkey
               }
             }`
          );

          console.info("queryResult >>>", queryResult);

          const { account } = queryResult?.data;

          console.info("pubkey >>>", account.pubkey);

          const keyBytes = publicStringToDER(account.pubkey);

          console.info("keyBytes >>>", keyBytes);

          const claim = {
            service: "verify-sys",
            rawData: uint8ArrayToHex(keyBytes),
          };

          console.info("claim >>>", claim);

          return { claim, pubkey: account.pubkey };
        },
      },
    ]);
});

const thisApplet = await getJson("/common/thisservice");

function App() {
  return html`auth-ec-sys`;
}

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);
root.render(html`<${App} />`);

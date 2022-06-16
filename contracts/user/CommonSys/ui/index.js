import { siblingUrl } from "/common/rootdomain.mjs";
import htm from "https://unpkg.com/htm@3.1.0?module";

const html = htm.bind(React.createElement);

("use strict");

let contracts = [
  {
    title: "Account Management",
    description: "Used to create and/or update your account.",
    contract: "account-sys",
    color: "red",
  },
  {
    title: "Block Explorer",
    description:
      "View the most recently produced blocks, all the way back to the beginning of the chain.",
    contract: "explore-sys",
    color: "green",
  },
  {
    title: "Wallet",
    description:
      "View your balance, send/swap tokens, other standard wallet functionality.",
    contract: "token-sys",
    color: "blue",
  },
];

function getApplications() {
  return contracts.map((c, index) => {
    return html`
      <div class="${c.color} card" key=${index}>
        <div class="content">
          <div class="header">${c.title}</div>
          <div class="description">${c.description}</div>
        </div>
        <a
          class="ui bottom attached button"
          href="${siblingUrl(null, c.contract)}"
        >
          <i
            class="arrow alternate circle right outline icon"
            style=${{
              marginRight: "5px",
            }}
          ></i>
          Check it out
        </a>
      </div>
    `;
  });
}

class App extends React.Component {
  render() {
    return html`
      <h1>psibase</h1>

      <h2>Featured Applications</h2>

      <div class="ui cards">${getApplications()}</div>
    `;
  }
}

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);
root.render(html`<${App} />`);

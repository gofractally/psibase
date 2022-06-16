import { getJson } from "/common/rpc.mjs";
import htm from "https://unpkg.com/htm@3.1.0?module";

const html = htm.bind(React.createElement);

const contract = await getJson("/common/thiscontract");

function activeIf(cName) {
  return cName === contract ? "active" : "";
}

function Nav() {
  return html`
    <div class="ui secondary menu">
      <a class="${activeIf("common-sys")} item" href=${siblingUrl()}> Home </a>
      <a
        class="${activeIf("token-sys")} item"
        href=${siblingUrl(null, "token-sys")}
      >
        Wallet
      </a>
      <div class="right menu">
        <div class="item">
          <button class="ui labeled icon button">
            <i class="circle icon"></i>
            Propose
          </button>
        </div>
        <div class="item">
          <div class="ui icon input">
            <input type="text" placeholder="Search..." />
            <i class="search link icon"></i>
          </div>
        </div>
        <a class="ui item"> Logout </a>
      </div>
    </div>
  `;
}

class CommonApp extends React.Component {
  render() {
    return html`
      <div
        class="ui container"
        style=${{
          marginTop: "10px",
        }}
      >
        <${Nav} />
      </div>
    `;
  }
}

const commonContainer = document.getElementById("commonRoot");
const commonRoot = ReactDOM.createRoot(commonContainer);
commonRoot.render(html`<${CommonApp} />`);

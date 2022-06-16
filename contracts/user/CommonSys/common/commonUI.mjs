import { siblingUrl } from "/common/rootdomain.mjs";
import htm from "https://unpkg.com/htm@3.1.0?module";

const html = htm.bind(React.createElement);

export function Nav() {
  return html`
    <div class="ui secondary menu">
      <a class="item" href=${siblingUrl()}> Home </a>
      <a class="active item"> Wallet </a>
      <div class="right menu">
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

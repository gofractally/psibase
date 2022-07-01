//import { siblingUrl } from "/common/rootdomain.mjs";
import { getJson } from "/common/rpc.mjs";
import htm from "https://unpkg.com/htm@3.1.0?module";
await import("https://unpkg.com/iframe-resizer@4.3.1/js/iframeResizer.js");

const html = htm.bind(React.createElement);
class Search extends React.Component {
  state = { term: "" };

  onSearchSubmit = (e) => {
    e.preventDefault();

    this.props.onSubmit(this.state.term);
  };

  render() {
    return html`
      <div class="ui segment">
        <h2>${this.props.title}</h2>
        <form onSubmit=${this.onSearchSubmit} class="ui form">
          <div class="field">
            <div class="ui left icon input">
              <input
                type="text"
                placeholder="Search accounts..."
                value=${this.state.term}
                onChange=${(e) => {
                  this.setState({ term: e.target.value });
                }}
              />
              <i class="users icon"></i>
            </div>
          </div>
        </form>
      </div>
    `;
  }
}

function Headers(headers) {
  return html`<tr>
    ${headers.map((x) => {
      return html`<th>${x}</th>`;
    })}
  </tr>`;
}

function Rows(balances) {
  return balances.map((b) => {
    return html`
      <tr>
        <td>${b.symbol ? b.symbol.toUpperCase() : b.token}</td>
        <td>${b.balance / Math.pow(10, b.precision)}</td>
      </tr>
    `;
  });
}

class BalanceTable extends React.Component {
  render() {
    return html`
      <div class="ui segment">
        <h2>${this.props.title}</h2>
        <table class="ui celled table">
          <thead>
            ${Headers(["token", "balance"])}
          </thead>
          <tbody>
            ${Rows(this.props.records)}
          </tbody>
        </table>
      </div>
    `;
  }
}

class EmptyPanel extends React.Component {
  render() {
    return html`
      <div class="ui segment">
        <p>Not yet implemented</p>
      </div>
    `;
  }
}

/*

 </div>
*/
class SendPanel extends React.Component {
  state = { dropdownActive: false };
  onSearchSubmit = async (term) => {
    //let b = await getJson("/balances/" + term);
  };

  onDropdownClicked = () => {
    console.log("dropdown clicked");
    this.setState({ dropdownActive: !this.state.dropdownActive });
  };

  render() {
    return html`
      <p>Under construction</p>
      <div
        onClick=${this.onDropdownClicked}
        class="ui fluid search selection dropdown ${this.state.dropdownActive
          ? "active visible"
          : ""}"
      >
        <input type="hidden" name="country" />
        <i class="dropdown icon"></i>
        <input class="search" autocomplete="off" tabindex="0" />
        <div class="text ${this.state.hasInput}">Select Token</div>
        <div
          class="menu transition ${this.state.dropdownActive
            ? "visible"
            : "hidden"}"
          style=${this.state.dropdownActive
            ? { display: "block !important" }
            : {}}
        >
          <div class="item" data-value="psi">PSI</div>
          <div class="item" data-value="eos">CAT</div>
        </div>
      </div>
    `;
  }
}

class ToolsTabs extends React.Component {
  state = {
    tabs: [
      {
        title: "Send",
        panel: html`<${SendPanel} />`,
        class: "active",
      },
      {
        title: "Swap",
        panel: html`<${EmptyPanel} />`,
        class: "",
      },
    ],
  };

  onTabClicked = (index) => {
    return () => {
      var tabs = this.state.tabs;
      tabs.forEach((t, i) => {
        t.class = i === index ? "active" : "";
      });
      this.setState({ tabs: tabs });
    };
  };

  render() {
    return html`
      <div class="ui container">
        <div class="ui top attached tabular menu">
          ${this.state.tabs.map((t, index) => {
            return html`
              <div
                key=${t.title}
                onClick=${this.onTabClicked(index)}
                class="item ${t.class}"
              >
                ${t.title}
              </div>
            `;
          })}
        </div>
        ${this.state.tabs.map((t) => {
          return html`
            <div
              key=${t.title}
              class="ui bottom attached tab segment ${t.class}"
            >
              ${t.panel}
            </div>
          `;
        })}
      </div>
    `;
  }
}

class App extends React.Component {
  state = { balances: [], user: "" };

  onSearchSubmit = async (term) => {
    let b = await getJson("/balances/" + term);
    console.log(b);
    this.setState({ balances: b });
    this.setState({ user: term });
  };

  render() {
    return html`
      <div class="ui container">
        <${Search} title="Select a user" onSubmit=${this.onSearchSubmit} />
        <${BalanceTable}
          title=${"Token balances: " + this.state.user}
          records=${this.state.balances}
        />
        <${ToolsTabs} />
      </div>
    `;
  }
}

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);
root.render(html`<${App} />`);

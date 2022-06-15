import { siblingUrl } from "/common/rootdomain.mjs";
import { getJson } from "/common/rpc.mjs";
import htm from "https://unpkg.com/htm@3.1.0?module";

const html = htm.bind(React.createElement);

function Nav() {
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
                key=${index}
                onClick=${this.onTabClicked(index)}
                class="item ${t.class}"
              >
                ${t.title}
              </div>
            `;
          })}
        </div>
        ${this.state.tabs.map((t, index) => {
          return html`
            <div key=${index} class="ui bottom attached tab segment ${t.class}">
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
      <div
        class="ui container"
        style=${{
          marginTop: "10px",
        }}
      >
        ${Nav()}
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

//const App = () => {

//    const tdStyle = {border: '1px solid'};
//    return html`
//         <div>
//             <a href=${siblingUrl()}>psibase</a>
//             <h1>explore-sys</h1>

//             <button onClick=${pagedResult.first}>First</button>
//             <button disabled=${!pagedResult.hasPreviousPage} onClick=${
//        pagedResult.previous}>Previous</button>
//             <button disabled=${!pagedResult.hasNextPage} onClick=${pagedResult.next}>Next</button>
//             <button onClick=${pagedResult.last}>Last</button>
//             <table>
//                 <tbody>
//                     <tr>
//                         <th style=${tdStyle}>Block</th>
//                         <th style=${tdStyle}>Previous</th>
//                         <th style=${tdStyle}>Time</th>
//                     </tr>
//                     ${pagedResult.result.data?.blocks.edges.map?.(e => html`<tr>
//                         <td style=${tdStyle}>${e.node.header.blockNum}</td>
//                         <td style=${tdStyle}>
//                             <pre>${e.node.header.previous}</pre>
//                         </td>
//                         <td style=${tdStyle}>${e.node.header.time}</td>
//                     </tr>`)}
//                 </tbody>
//             </table>
//         </div>`;
//};

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);
root.render(html`<${App} />`);

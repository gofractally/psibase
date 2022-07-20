import htm from "/common/htm.module.js";
import { siblingUrl } from "/common/rootdomain.mjs";
import { initializeApplet, 
  getJson, action, addRoute, push, 
  getLocalResource, CommonResources } from "/common/rpc.mjs";

const html = htm.bind(React.createElement);
const { useEffect, useState, useCallback, useRef } = React;

await initializeApplet();

export const thisApplet = await getJson('/common/thiscontract');

const transactionTypes = {
  credit: 0,
};

function Headers(headers) {
  return html`<tr>
    ${headers.map((x, index) => {
      return html`<th key=${index}>${x}</th>`;
    })}
  </tr>`;
}

function Rows(balances) {
  return balances.map((b, index) => {
    return html`
      <tr key=${index}>
        <td>${b.symbol ? b.symbol.toUpperCase() : b.token}</td>
        <td>${b.balance / Math.pow(10, b.precision)}</td>
      </tr>
    `;
  });
}

function BalanceTable({loggedInUser}) {

  const [balances, setBalances] = useState([]);
  const [user, setUser] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const onSearchSubmit = (e) => {
    e.preventDefault();
    setUser(searchTerm);
  };

  useEffect(()=>{
    setSearchTerm(loggedInUser);
    setUser(loggedInUser);
  }, [loggedInUser]);

  const getBalances = useCallback(async () => {
    if (user)
    {
      let res = await getJson(siblingUrl(null, thisApplet, "balances/" + user));
      setBalances(res);
    }
  }, [user]);

  useEffect(()=>{
    getBalances().catch(console.error);
  }, [getBalances])

  const refreshBalances = useCallback((trace) => {
    getBalances().catch(console.error);
  }, [user]);

  useEffect(()=>{
    addRoute("refreshbalances", transactionTypes.credit, refreshBalances);
  }, [refreshBalances]);

  return html`
    <div class="ui segment">
      <h2>Token balances</h2>
      <form onSubmit=${onSearchSubmit} class="ui form">
        <div class="field">
          <div class="ui left icon input">
            <input
              type="text"
              placeholder="Search accounts..."
              value=${searchTerm}
              onChange=${(e) => {
                setSearchTerm(e.target.value);
              }}
            />
            <i class="users icon"></i>
          </div>
        </div>
      </form>
      <table class="ui celled table">
        <thead>
          ${Headers(["token", "balance"])}
        </thead>
        <tbody>
          ${Rows(balances)}
        </tbody>
      </table>
    </div>
  `;
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

function makeLabel(lab, placeholder, val, disabled, onChanged)
{
  let getValue = () => {
    return val == null? "" : val;
  };

  if (disabled)
  {
    return html`
    <div class="ui fluid labeled input" style="${{marginTop: "5px"}}">
      <div class="ui label">
        ${lab}
      </div>
      <input 
        type="text"
        placeholder="${placeholder}"
        value="${getValue()}"
        disabled
        onChange=${(e) => {
          onChanged(e.target.value);
        }}
      />
    </div>
    <br />
    `;
  }
  else
  {
    return html`
    <div class="ui fluid labeled input" style="${{marginTop: "5px"}}">
      <div class="ui label">
        ${lab}
      </div>

      <input 
        type="text"
        placeholder="${placeholder}"
        value="${getValue()}"
        onChange=${(e) => {
          onChanged(e.target.value);
        }}
      />
    </div>
    <br />
    `;
  }
}

function SubmitButton(props) {
  return html`<button class="ui primary button" onClick=${props.callback}>Send</button>`;
}

function SendPanel() {
  const [receiver, setReceiver] = useState("bob");
  const [token, setToken] = useState("PSI");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");

  const credited = useCallback( async (payload) =>{
    setStatus("Transfer successful!");
    setTimeout(()=>{setStatus("");}, 5000);
  }, []);

  useEffect(()=>{
    addRoute("credited", transactionTypes.credit, credited);
  }, [credited]);

  const onSendSubmit = (e) => {
    e.preventDefault();
    const credit = async () => {

      push(transactionTypes.credit, [await action(
        thisApplet, "credit", 
        {
          tokenId: 1, 
          receiver: receiver, 
          amount: {value: amount },
          memo: {contents: "Test"},
        }
      )]);
    }
    credit().catch(console.error);
  };

  return html`
    <form onSubmit=${onSendSubmit} class="ui form">
      ${makeLabel("To:", "Receiver account", receiver, true, setReceiver)}
      ${makeLabel("Token:", "Token", token, true, setToken)}
      ${makeLabel("Amount: $", "Amount", amount, false, setAmount)}
      <${SubmitButton} callback=${onSendSubmit} />
    </form>
    <p>${status}</p>
  `;
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

function App() {

  const [user, setUser] = useState("");

  useEffect(()=>{
    // Todo - Timeout is used because sometimes the window.parentIFrame isn't loaded yet when 
    //  this runs. Should use a better fix for the race condition than a delay.
    setTimeout(()=>{ 
      getLocalResource(CommonResources.loggedInUser, setUser);
    }, 50);
  }, []);

  return html`
    <div class="ui container">
      <h1>Wallet</h1>
      <${BalanceTable } loggedInUser=${user} />
      <${ToolsTabs} />
    </div>
  `;
}

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);
root.render(html`<${App} />`);

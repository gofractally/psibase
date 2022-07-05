import { siblingUrl } from "/common/rootdomain.mjs";
import { getJson } from "/common/rpc.mjs";
import htm from "https://unpkg.com/htm@3.1.0?module";
await import(
  "https://unpkg.com/react-router-dom@5.3.3/umd/react-router-dom.min.js"
);

const html = htm.bind(React.createElement);

const { useEffect } = React;
const { BrowserRouter, Route } = ReactRouterDOM;

const appletPrefix = "/applet/";

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

function activeIf(cName) {
  if (cName === "common-sys")
  {
    return window.location.pathname === "/" ? "active" : "";
  }
  else
  {
    return window.location.pathname.indexOf(cName) != -1 ? "active" : "";
  }
}

function Nav() {
  return html`
    <div class="ui secondary menu" style=${{ paddingBottom: "10px" }}>
      <a class="${activeIf("common-sys")} item" href=${siblingUrl()}> Home </a>
      <a
        class="${activeIf("token-sys")} item"
        href=${siblingUrl(null, "", "applet/token-sys")}
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

function Applet() {
  const path = window.location.pathname;
  var applet = path.substring(appletPrefix.length);
  var subPath = "";
  const startOfSubpath = applet.indexOf("/");
  if (startOfSubpath != -1) {
    subPath = applet.substring(startOfSubpath);
    applet = applet.substring(0, startOfSubpath);
  }

  useEffect(() => {
    window.document.title = applet;
  }, []);

  useEffect(() => {
    // All options: https://github.com/davidjbradshaw/iframe-resizer/blob/master/docs/parent_page/options.md
    iFrameResize(
      {
        // log: true,
        // checkOrigin: false,
        heightCalculationMethod: "lowestElement",
        onMessage: ({ iframe, message }) => {
          console.log("MESSAGE: ");
          console.log(iframe);
          console.log(message);
        },
        minHeight:
          document.documentElement.scrollHeight -
          document.getElementById("applet").getBoundingClientRect().top,
      },
      "#applet"
    );
  }, []);

  return html`
    <iframe
      id="applet"
      style=${{
        margin: 0,
        padding: 0,
      }}
      src="${siblingUrl(null, applet, subPath)}"
      title="TODO Applet Description"
      frameborder="0"
    ></iframe>
  `;
}

function Dashboard() {
  useEffect(() => {
    window.document.title = "Psinet Dashboard";
  }, []);

  return html`
    <div class="ui container">
      <h1>psinet</h1>
      <h2>Featured Applications</h2>
      <div class="ui cards">
        ${contracts.map((c, index) => {
          return html`
            <div key=${index} class="${c.color} card">
              <div class="content">
                <div class="header">${c.title}</div>
                <div class="description">${c.description}</div>
              </div>
              <a href="${appletPrefix}${c.contract}">
                <div class="ui bottom attached button">
                  <i
                    class="arrow alternate circle right outline icon"
                    style=${{
                      marginRight: "5px",
                    }}
                  ></i>
                  Check it out
                </div>
              </a>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function App() {
  return html`
    <div class="ui container">
      <${Nav} />
    </div>
    <${BrowserRouter}>
      <div>
        <${Route} path="/" exact component=${Dashboard} />
        <${Route} path="${appletPrefix}" component=${Applet} />
      </div>
    </${BrowserRouter}>
  `;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(html`<${App} />`);

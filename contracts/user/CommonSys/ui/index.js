import { siblingUrl } from "/common/rootdomain.mjs";
import { signAndPushTransaction, getTaposForHeadBlock, CommonResources, ErrorCodes, MessageTypes } from "/common/rpc.mjs";
import htm from "/common/htm.module.js";
await import("/common/react-router-dom.min.js");

const html = htm.bind(React.createElement);

const { useEffect, useState } = React;
const { BrowserRouter, Route } = ReactRouterDOM;

const appletPrefix = "/applet/";

("use strict");

let contracts = [
  {
    title: "Account Creation",
    description: "Create a new account. Only available on testnet.",
    contract: "account-sys",
    color: "teal"
  },
  {
    title: "Account Management",
    description: "Used to manage your existing accounts.",
    contract: "auth-ec-sys",
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

const injectSender = (actions) => {
  actions.forEach(action => {
    if (typeof action.sender === 'undefined')
    {
      action.sender = messageRouting[MessageTypes.getResource].getResponse({id: 0, resource: CommonResources.loggedInUser}).resource;
    }
  });

  return actions;
};

const constructTransaction = async (actions) => {
  let tenMinutes = 10 * 60 * 1000;
  var transaction = JSON.parse(JSON.stringify({
      tapos: {
          ...await getTaposForHeadBlock(),
          expiration: new Date(Date.now() + tenMinutes),
      },
      actions,
  }, null, 4));

  return transaction;
};

let messageRouting = [
  {
    type: MessageTypes.getResource,
    validate: (payload) => {
      if (payload.id === undefined || typeof payload.id !== "number")
      {
        console.error("Received malformed resource request from applet (malformed id)");
        return false;
      }
      return true;
    },
    getResponse: (payload) => {
      let { id, resource } = payload;
      if (resource === CommonResources.loggedInUser)
      {
        // Todo - get sender from key management extension
        return {id, resource: "alice"};
      }
      else
      {
        console.error("Resource with invalid id (" + resource + ") requested");
        return {id, resource: "", error: ErrorCodes.invalidResource};
      }
    },
  },
  {
    type: MessageTypes.transaction,
    validate: (payload) => {
      if (payload.actions === undefined || !Array.isArray(payload.actions))
      {
        console.error("Error in transaction message from applet (action array missing or malformed)");
        return false;
      }
      return true;
    },
    getResponse: async (payload) => {
      let {type, actions} = payload;

      try 
      {
        let trans = await constructTransaction(injectSender(actions));
        let trace = await signAndPushTransaction('', trans);
        return {type, trace};
      }
      catch (e)
      {
        return {type, trace: "", error: ErrorCodes.serverError};
      }
    }
  },
];



function Applet() {
  
  const [applet, setApplet] = useState("");
  const [appletSrc, setAppletSrc] = useState("");

  useEffect(() => {
    const pathname = window.location.pathname;
    var appletStr = pathname.substring(appletPrefix.length);
    var subPath = "";
    const startOfSubpath = appletStr.indexOf("/");
    if (startOfSubpath != -1) {
      subPath = appletStr.substring(startOfSubpath);
      appletStr = appletStr.substring(0, startOfSubpath);
    }

    setApplet(appletStr);
    setAppletSrc(siblingUrl(null, appletStr, subPath));
  }, []);

  useEffect(()=>{
    if (applet)
    {
      window.document.title = applet;
    }
  }, [applet]);

  useEffect(() => {
    const handleMessage = async (request) => {
      var iframe = document.getElementById("applet");
      if (iframe == null)
      {
        console.error("Child iframe not found.");
        return;
      }
      let {type, payload} = request.message;
      if (type === undefined || typeof type !== "number" || payload === undefined)
      {
        console.error("Received malformed resource request from applet");
        return;
      }
      if (!messageRouting[type].validate(payload)) 
        return;

      // Get and send response
      var responsePayload = await messageRouting[type].getResponse(payload);
      iframe.iFrameResizer.sendMessage({type, payload: responsePayload}, appletSrc);
    };

    if (appletSrc)
    {
      iFrameResize(
        {
          // All options: https://github.com/davidjbradshaw/iframe-resizer/blob/master/docs/parent_page/options.md
          //log: true,
          checkOrigin: false,
          heightCalculationMethod: "lowestElement",
          onMessage: handleMessage,
          minHeight:
            document.documentElement.scrollHeight -
            document.getElementById("applet").getBoundingClientRect().top,
        },
        "#applet"
      )[0].iFrameResizer;
    }
  }, [appletSrc]);

  if (appletSrc)
  {
    return html`
    <iframe
      id="applet"
      style=${{
        margin: 0,
        padding: 0
      }}
      src="${appletSrc}"
      title="${applet}"
      frameborder="0"
    ></iframe>
  `;
  }
  else
  {
    return html`
    <div class="ui segment">
      <div class="ui active inverted dimmer">
        <div class="ui text loader">Loading</div>
      </div>
      <p></p>
    </div>
    `;
  }
  
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

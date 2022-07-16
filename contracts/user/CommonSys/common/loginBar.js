import { siblingUrl } from "/common/rootdomain.mjs";
import htm from "https://unpkg.com/htm@3.1.0?module";

if (typeof React === 'undefined') {
  await import("https://unpkg.com/react@18/umd/react.production.min.js");
  await import(
    "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"
  );
}

const html = htm.bind(React.createElement);

function inIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}

class LoginBar extends React.Component {
  render() {
    if (inIframe()) return;

    const applet = window.location.hostname.substring(
      0,
      window.location.hostname.indexOf(".")
    );

    return html`
      <div
        class="ui container"
        style=${{
          paddingTop: "10px",
          paddingBottom: "10px",
        }}
      >
        <div class="ui secondary menu">
          <a
            class="ui primary button"
            href=${siblingUrl(null, "", "/applet/" + applet)}
          >
            Login
          </a>
        </div>
      </div>
    `;
  }
}

document.body.insertBefore(
  document.createElement("div"),
  document.body.firstChild
);
const container = document.body.firstChild;
const root = ReactDOM.createRoot(container);
root.render(html`<${LoginBar} />`);

import { postJsonGetJson, pushedSignedTransaction } from '/common/rpc.mjs';
import { siblingUrl } from '/common/rootdomain.mjs';

// TODO: mirror this
import htm from "https://unpkg.com/htm@3.1.0?module";
const html = htm.bind(React.createElement);

const App = () => {
    return html`
        <div>
            <a href=${siblingUrl()}>psibase</a>
            <h1>blocklog-sys</h1>
        
            Hello World!<br />
        </div>`;
};

const container = document.getElementById('root');
const root = ReactDOM.createRoot(container);
root.render(html`<${App} />`);

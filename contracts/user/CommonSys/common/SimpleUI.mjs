import htm from 'https://unpkg.com/htm@3.1.0?module';
import { getJson, packAction, signAndPushTransaction } from './rpc.mjs';

await import('https://unpkg.com/react@18/umd/react.production.min.js');
await import('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js');
const html = htm.bind(React.createElement);

const contract = await getJson('/common/thiscontract');
const actionTemplates = await getJson('/action_templates');

async function pushTransaction(transaction, keys, addMsg, clearMsg) {
    try {
        clearMsg();
        transaction.actions = await Promise.all(transaction.actions.map(async action => {
            console.log(action);
            addMsg(`packing ${action.method}...`);
            action = await packAction(null, action);
            addMsg('rawData: ' + action.rawData);
            return action;
        }));
        const trace = await signAndPushTransaction('', transaction, keys);
        addMsg('\nPushed\n');
        addMsg(JSON.stringify(trace, null, 4));
    } catch (e) {
        console.error(e);
        addMsg('');
        addMsg(e.message);
        if (e.trace) {
            addMsg('');
            addMsg('trace: ' + JSON.stringify(e.trace, null, 4));
        }
    }
}

function useMsg() {
    const [msg, setMsg] = React.useState('');
    const [nonSignallingState] = React.useState({ msg: '' });
    const clearMsg = () => {
        nonSignallingState.msg = '';
        setMsg(nonSignallingState.msg);
    };
    const addMsg = (msg) => {
        nonSignallingState.msg += msg + '\n';
        setMsg(nonSignallingState.msg);
    };
    return { msg, addMsg, clearMsg };
}

function ActionButtons({ setTrx }) {
    return Object.entries(actionTemplates).map(([method, data]) => {
        const onClick = e => {
            setTrx(JSON.stringify({
                tapos: {
                    expiration: new Date(Date.now() + 10 * 60 * 1000),
                },
                actions: [{
                    sender: contract,
                    contract,
                    method,
                    data,
                }],
            }, null, 4))
        };
        return html`<button onClick=${onClick}>${method}</button>`;
    })
}

function App() {
    const [trx, setTrx] = React.useState('');
    const [keys, setKeys] = React.useState('');
    const { msg, addMsg, clearMsg } = useMsg();
    const pushTrx = e =>
        pushTransaction(
            JSON.parse(trx),
            keys.split('\n').map(s => s.trim()).filter(s => s), addMsg, clearMsg
        );
    return html`<div>
        <h1>${contract}</h1>
        <h2>Transaction</h2>
        <div><${ActionButtons} setTrx=${setTrx}/></div>
        <textarea rows=20 cols=80 value=${trx} onChange=${e => setTrx(e.target.value)}></textarea>
        <h3>Private Keys</h3>
        <textarea rows=3 cols=80 value=${keys} onChange=${e => setKeys(e.target.value)}></textarea>
        <div>
            <button onClick=${pushTrx}>Push Transaction</button>
        </div>
        <h2>Messages</h2>
        <pre style=${{ border: '1px solid' }}><code>${msg}</code></pre>
    </div>`;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(html`<${App}/>`);

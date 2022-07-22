import htm from 'https://unpkg.com/htm@3.1.0?module';
import { getJson, initializeApplet, addRoute, push, action } from '/common/rpc.mjs';

const html = htm.bind(React.createElement);

await initializeApplet();
const thisApplet = await getJson('/common/thiscontract');

let transactionTypes = {
    newacc: 0,
};

function useAccounts(addMsg, clearMsg) {
    const [accounts, setAccounts] = React.useState([]);

    const refreshAccounts = React.useCallback((trace) => {
        (async () => {
            addMsg(JSON.stringify(trace, null, 4));
            try {
                setAccounts(await getJson('/accounts'));
            }
            catch (e) {
                clearMsg();
                addMsg(e);
            }
        })();
    }, []);

    React.useEffect(refreshAccounts, []);

    React.useEffect(()=>{
        addRoute("accCreated", transactionTypes.newacc, refreshAccounts);
    }, [refreshAccounts]);
    

    return accounts;
}

function AccountList(addMsg, clearMsg) {
    const accounts = useAccounts(addMsg, clearMsg);
    return html`<table><tbody>${accounts.map(account =>
        html`<tr key=${account.num}>
                <td style=${{ border: '2px solid' }}>${account.num}</td>
                <td style=${{ border: '2px solid' }}>${account.authContract}</td>
                <td style=${{ border: '2px solid' }}>${account.flags}</td>
                <td style=${{ border: '2px solid' }}>${account.codeHash}</td>
            </tr>`
    )}</tbody></table>`
}

async function newAccount(name, pubkey, addMsg, clearMsg) {
    try {
        clearMsg();
        addMsg("Pushing transaction...");

        var actions = [await action(
            thisApplet, 
            "newAccount", 
            { 
                name, 
                authContract: 'auth-fake-sys', 
                requireNew: true 
            },
            thisApplet,
          )];

        if (pubkey)
            actions = actions.concat([
                await action('auth-ec-sys', 'setKey', {key: pubkey}, name),
                await action('auth-ec-sys', 'setAuthCntr', {authContract: ''}, name), 
            ]);

        push(transactionTypes.newacc, actions);

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

function AccountForm(addMsg, clearMsg) {
    const [name, setName] = React.useState('');
    const [pubkey, setPubkey] = React.useState('');
    return html`<div>
        <table><tbody>
            <tr>
                <td>Name</td>
                <td><input type="text" value=${name} onChange=${e => setName(e.target.value)}></input></td>
            </tr>
            <tr>
                <td>Public Key</td>
                <td><input type="text" value=${pubkey} onChange=${e => setPubkey(e.target.value)}></input></td>
            </tr>
            <tr>
                <td></td>
                <td><button onClick=${e => newAccount(name, pubkey, addMsg, clearMsg)}>Create Account</button></td>
            </tr>
        </tbody></table>
    </div>`
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

function App() {
    const [trx, setTrx] = React.useState('');
    const { msg, addMsg, clearMsg } = useMsg();
    return html`<div class="ui container">
        <h1>account_sys</h1>
        <h2>Accounts</h2>
        ${AccountList(addMsg, clearMsg)}
        <h2>Create Account</h2>
        ${AccountForm(addMsg, clearMsg)}
        <h2>Messages</h2>
        <pre style=${{ border: '1px solid' }}><code>${msg}</code></pre>
    </div>`;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(html`<${App}/>`);
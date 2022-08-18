import htm from 'https://unpkg.com/htm@3.1.0?module';
import { getJson, initializeApplet, action, operation, setOperations, setQueries } from '/common/rpc.mjs';
import { genKeyPair, KeyType } from '/common/keyConversions.mjs';

const html = htm.bind(React.createElement);

const thisApplet = await getJson('/common/thiscontract');
initializeApplet(async () => {
    setOperations([
        {
            id: "newAcc",
            exec: ({ name, pubKey }) => {
                action(thisApplet, "newAccount", {
                    name,
                    authContract: 'auth-fake-sys',
                    requireNew: true,
                });

                if (pubKey !== "") {
                    action('auth-ec-sys', 'setKey', { key: pubKey }, name);
                    action(thisApplet, 'setAuthCntr', { authContract: 'auth-ec-sys' }, name);
                }
            },
        },
    ]);
    setQueries([
        {
            id: "getLoggedInUser",
            exec: (params, reply) => {
                reply("alice");
            },
        },
    ]);
});

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

    return accounts;
}

function AccountList(addMsg, clearMsg) {
    const accounts = useAccounts(addMsg, clearMsg);
    return html`<table><tbody>${accounts.map(account =>
        html`<tr key=${account.num}>
                <td style=${{ border: '2px solid' }}>${account.accountNum}</td>
                <td style=${{ border: '2px solid' }}>${account.authContract}</td>
            </tr>`
    )}</tbody></table>`
}

async function newAccount(name, pubKey, addMsg, clearMsg) {
    try {
        clearMsg();
        addMsg("Pushing transaction...");

        operation(thisApplet, "", "newAcc", { name, pubKey });

    } catch (e) {
        console.log('caught')
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

function KeyPair() {
    const [pub, setPub] = React.useState('');
    const [priv, setPriv] = React.useState('');

    let generateKeyPair = () => {
        let kp = genKeyPair(KeyType.k1);
        setPub(kp.pub);
        setPriv(kp.priv);
    };

    return html`
        <div>
            <table><tbody>
                <tr>
                        <td></td>
                        <td><button onClick=${generateKeyPair}>Generate</button></td>
                </tr>    
                <tr>
                    <td>Public key</td>
                    <td><input type="text" disabled value=${pub}></input></td>
                </tr>
                <tr>
                    <td>Private key</td>
                    <td><input type="text" disabled value=${priv}></input></td>
                </tr>
            </tbody></table>
        </div>
    `;
}

function App() {
    const [trx, setTrx] = React.useState('');
    const { msg, addMsg, clearMsg } = useMsg();
    return html`<div class="ui container">
        <h1>account_sys</h1>
        <h2>Accounts</h2>
        ${AccountList(addMsg, clearMsg)}
        <h2>Generate Key Pair</h2>
        <${KeyPair} />
        <h2>Create Account</h2>
        ${AccountForm(addMsg, clearMsg)}
        <h2>Messages</h2>
        <pre style=${{ border: '1px solid' }}><code>${msg}</code></pre>
    </div>`;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(html`<${App}/>`);
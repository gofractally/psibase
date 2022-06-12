import {getJson, packAndPushSignedTransaction, postJsonGetArrayBuffer, uint8ArrayToHex} from '/common/rpc.mjs';
import htm from 'https://unpkg.com/htm@3.1.0?module';

await import('https://unpkg.com/react@18/umd/react.production.min.js');
await import('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js');
const html = htm.bind(React.createElement);

function useAccounts(addMsg, clearMsg)
{
   const [accounts, setAccounts] = React.useState([]);
   React.useEffect(() => {
      (async () => {
         try
         {
            setAccounts(await getJson('/accounts'));
         }
         catch (e)
         {
            clearMsg();
            addMsg(e);
         }
      })();
   }, []);
   return accounts;
}

function AccountList(addMsg, clearMsg)
{
   const accounts = useAccounts(addMsg, clearMsg);
   return html`<table><tbody>${accounts.map(account => html`<tr key=${account.num}>
                <td style=${{
                                               border: '2px solid'
                                            }}>${account.num}</td>
                <td style=${{
                                               border: '2px solid'
                                            }}>${account.authContract}</td>
                <td style=${{
                                               border: '2px solid'
                                            }}>${account.flags}</td>
                <td style=${{
                                               border: '2px solid'
                                            }}>${account.codeHash}</td>
            </tr>`)}</tbody></table>`
}

async function newAccount(name, pubkey, addMsg, clearMsg)
{
   try
   {
      clearMsg();
      addMsg('Pushing transaction...');
      let actions = [{
         sender: 'account-sys',
         contract: 'account-sys',
         method: 'newAccount',
         data: {name, authContract: 'auth-fake-sys', requireNew: true},
      }];
      if (pubkey)
         actions = actions.concat([
            {
               sender: name,
               contract: 'auth-ec-sys',
               method: 'setKey',
               data: {key: pubkey},
            },
            {
               sender: name,
               contract: 'account-sys',
               method: 'setAuthCntr',
               data: {authContract: 'auth-ec-sys'},
            }
         ]);
      const trace = await packAndPushSignedTransaction('', {
         transaction: {
            tapos: {
               expiration: new Date(Date.now() + 10_000),
            },
            actions,
         }
      });
      addMsg(JSON.stringify(trace, null, 4));
   }
   catch (e)
   {
      console.error(e);
      addMsg('');
      addMsg(e.message);
      if (e.trace)
      {
         addMsg('');
         addMsg('trace: ' + JSON.stringify(e.trace, null, 4));
      }
   }
}

function AccountForm(addMsg, clearMsg)
{
   const [name, setName]     = React.useState('');
   const [pubkey, setPubkey] = React.useState('');
   return html`<div>
        <table><tbody>
            <tr>
                <td>Name</td>
                <td><input type="text" value=${name} onChange=${
       e => setName(e.target.value)}></input></td>
            </tr>
            <tr>
                <td>Public Key</td>
                <td><input type="text" value=${pubkey} onChange=${
       e => setPubkey(e.target.value)}></input></td>
            </tr>
            <tr>
                <td></td>
                <td><button onClick=${
       e => newAccount(name, pubkey, addMsg, clearMsg)}>Create Account</button></td>
            </tr>
        </tbody></table>
    </div>`
}

function useMsg()
{
   const [msg, setMsg]        = React.useState('');
   const [nonSignallingState] = React.useState({msg: ''});
   const clearMsg = () => {
      nonSignallingState.msg = '';
      setMsg(nonSignallingState.msg);
   };
   const addMsg = (msg) => {
      nonSignallingState.msg += msg + '\n';
      setMsg(nonSignallingState.msg);
   };
   return {msg, addMsg, clearMsg};
}

function App()
{
   const [trx, setTrx]           = React.useState('');
   const {msg, addMsg, clearMsg} = useMsg();
   return html`<div>
        <h1>account_sys</h1>
        <h2>Accounts</h2>
        ${AccountList(addMsg, clearMsg)}
        <h2>Create Account</h2>
        ${AccountForm(addMsg, clearMsg)}
        <h2>Messages</h2>
        <pre style=${
   {
      border: '1px solid'
   }
   }><code>${msg}</code></pre>
    </div>`;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(html`<${App}/>`);

import htm from "/common/htm.module.js";
import { initializeApplet, 
  getJson} from "/common/rpc.mjs";
import { keyPairStrings, privateStringToKeyPair } from "/common/keyConversions.mjs";

const html = htm.bind(React.createElement);
const { useEffect, useState, useCallback } = React;
const { Segment, Header, Icon, Modal, Form, Table, Input, Button, Message, Tab, Container } = semanticUIReact;

await initializeApplet();

const thisApplet = await getJson('/common/thiscontract');

// const transactionTypes = {
//   credit: 0,
// };

// Simple useLocalStorage hook taken from:
//    https://usehooks.com/useLocalStorage/
function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    if (typeof window === "undefined") {
      return initialValue;
    }
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.log(error);
      return initialValue;
    }
  });

  const setValue = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch (error) {
      console.error(error);
    }
  };
  return [storedValue, setValue];
}

function ErrorPane(props) 
{
  if (props.show === true)
  {
    return html`
      <${Message} negative header='Import failure' content='Failed to import accounts for given private key.' />
    `;
  }
  else return html``;
}

function App() {

  const [priv, setPriv] = useState("");
  const [impErr, setImpErr] = useState(false);

  const [keys, setKeys] = useLocalStorage("keys", []);
  const [accounts, setAccounts] = useLocalStorage("accounts", []);

  let showImportError = () => {
    setImpErr(true);
    setTimeout(()=>{
      setImpErr(false);
    }, 5000);
  };

  let Accounts = () => {
    console.log("rerendering with " + accounts.length + " accounts.");
    let accountRows = accounts.map((a)=>{
      return html`
        <${Table.Row}>
          <${Table.Cell}>${a.account}</${Table.Cell}>
          <${Table.Cell}>${a.pubkey}</${Table.Cell}>
          <${Table.Cell}><${Button} fluid>Login</${Button}></${Table.Cell}>
        </${Table.Row}>
      `;
    });
    console.log(accountRows);
    if (accountRows) 
    {
        return accountRows;
    }
    else return html``;
  };

  let doImport = async (privateKey) => {
    if (privateKey === null || !privateKey)
    {
      console.error("Failed to import private key");
      return;
    }
    if (keys.includes(privateKey))
    {
      console.error("Already imported that private key");
      return;
    }

    try {
      let keypair = keyPairStrings(privateStringToKeyPair(privateKey));
      let res = await getJson(await siblingUrl(null, thisApplet, "accwithkey/" + keypair.pub));
      setKeys(keys.concat([privateKey]));
      setAccounts(accounts.concat(res));
    } catch(e)
    {
      showImportError();
      console.error(e);
    }
  };

  return html`
    <${Container}>
      <${Header} as='h1'>Manage Accounts</${Header}>
      <${Segment}>
      <${Header} as='h2'>Managed accounts</${Header}>
        <${Table} celled>
          <${Table.Header}>
            <${Table.Row}>
              <${Table.HeaderCell}collapsing>Account</${Table.HeaderCell}>
              <${Table.HeaderCell}>Public key</${Table.HeaderCell}>
              <${Table.HeaderCell} collapsing />
            </${Table.Row}>
          </${Table.Header}>

          <${Table.Body}>
            <${Accounts} />
          </${Table.Body}>
        </${Table}>

        <${Modal}
          trigger=${html`<${Button} primary><${Icon} name='add circle' /> Import account</${Button}>`}
          header='Import by private key'
          dimmer='blurring'
          closeOnEscape=${false}
          closeOnDimmerClick=${false}
          content='${html`
            <${Container}>
              <${Input} fluid label='Private key:' placeholder='Enter private key...' onChange=${(e)=>{setPriv(e.target.value);}} value=${priv}>
            </${Container}>
          `}'
          actions=${[
            { key: 'cancel', content: 'Cancel', positive: false, onClick: ()=>{setPriv("");} }, 
            { key: 'add', content: 'Add', positive: true, onClick: ()=>{
              doImport(priv);
              setPriv("");
            } }
          ]}
        />
        <${ErrorPane} show=${impErr}/>

      </${Segment}>
    </${Container}>
  `;
}

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);
root.render(html`<${App} />`);

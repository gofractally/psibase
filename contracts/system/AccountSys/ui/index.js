import htm from "/common/htm.module.js";
import { siblingUrl } from "/common/rootdomain.mjs";
import { initializeApplet, 
  getJson, action, addRoute, push, 
  CommonResources } from "/common/rpc.mjs";
import { keyPairStrings, privateStringToKeyPair } from "/common/keyConversions.mjs";

const html = htm.bind(React.createElement);
const { useEffect, useState, useCallback } = React;
const { Segment, Header, Icon, Modal, Form, Table, Input, Button, Message, Tab, Container } = semanticUIReact;

await initializeApplet();

const thisApplet = await getJson('/common/thiscontract');

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

  const [keys, setKeys] = useLocalStorage("keys", []);
  const [accounts, setAccounts] = useLocalStorage("accounts", []);

  const setManagedAccounts = useCallback( async (payload) =>{
    console.log("managed accounts set.");
    console.log(payload);
  }, []);

  useEffect(()=>{
    try{
        
        callApplet("auth-ec-sys", "", "getAccounts", {}, setManagedAccounts);

        let res = await getJson(siblingUrl(null, thisApplet, "accwithkey/" + keypair.pub));
        setKeys(keys.concat([privateKey]));
        setAccounts(accounts.concat(res));
    } 
    catch(e)
    {
        console.error(e);
    }
  }, []);

  let Accounts = () => {
    let accountRows = accounts.map((a)=>{
      return html`
        <${Table.Row}>
          <${Table.Cell}>${a.account}</${Table.Cell}>
          <${Table.Cell}>${a.authContract}</${Table.Cell}>
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

  return html`
    <${Container}>
      <${Header} as='h1'>Account Management</${Header}>
      <${Segment}>
      <${Header} as='h2'>Your accounts</${Header}>
        <${Table} celled>
          <${Table.Header}>
            <${Table.Row}>
              <${Table.HeaderCell} collapsing>Account</${Table.HeaderCell}>
              <${Table.HeaderCell} collapsing>Authorization method</${Table.HeaderCell}>
              <${Table.HeaderCell} collapsing />
            </${Table.Row}>
          </${Table.Header}>

          <${Table.Body}>
            <${Accounts} />
          </${Table.Body}>
        </${Table}>

      </${Segment}>
    </${Container}>
  `;
}

/*
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
*/

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);
root.render(html`<${App} />`);

import htm from "/common/htm.module.js";
import { siblingUrl } from "/common/rootdomain.mjs";
import { initializeApplet, 
  getJson, action, addRoute, push, 
  getLocalResource, CommonResources } from "/common/rpc.mjs";

const html = htm.bind(React.createElement);
const { useEffect, useState, useCallback } = React;
const { Segment, Header, Icon, Modal, Form, Table, Input, Button, Message, Tab, Container } = semanticUIReact;

await initializeApplet();

//export const thisApplet = await getJson('/common/thiscontract');

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



function Imported(props) {
  if (props.imported)
  {
    return html`Imported`;
  }
  else return html``;
}

function App() {

  const [priv, setPriv] = useState("");

  const [keys, setKeys] = useLocalStorage("keys", []);

  let doImport = (privateKey) => {
    setKeys(keys.concat([privateKey]));
  };

  useEffect(()=>{
    console.log("Keys changed: ");
    console.log(keys);
  }, [keys]);

  return html`
    <${Container}>
      <${Header} as='h1'>Manage Accounts</${Header}>
      <${Segment}>
      <${Header} as='h2'>Existing accounts</${Header}>
        <${Table} celled>
          <${Table.Header}>
            <${Table.Row}>
              <${Table.HeaderCell}collapsing>Account</${Table.HeaderCell}>
              <${Table.HeaderCell} collapsing />
            </${Table.Row}>
          </${Table.Header}>

          <${Table.Body}>
            <${Table.Row}>
              <${Table.Cell}>alice</${Table.Cell}>
              <${Table.Cell}><${Button} fluid>Login</${Button}></${Table.Cell}>
            </${Table.Row}>
            <${Table.Row}>
              <${Table.Cell}>bob</${Table.Cell}>
              <${Table.Cell}><${Button} fluid>Login</${Button}></${Table.Cell}>
            </${Table.Row}>
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

      </${Segment}>
    </${Container}>
  `;
}

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);
root.render(html`<${App} />`);

import htm from "/common/htm.module.js";
import { siblingUrl } from "/common/rootdomain.mjs";
import { initializeApplet, 
  getJson, action, addRoute, push, 
  getLocalResource, CommonResources } from "/common/rpc.mjs";

const html = htm.bind(React.createElement);
const { useEffect, useState, useCallback } = React;
const { Segment, Header, Form, Table, Input, Button, Message, Tab, Container } = semanticUIReact;

await initializeApplet();

export const thisApplet = await getJson('/common/thiscontract');

const transactionTypes = {
  credit: 0,
};

function Rows(balances) {
  return balances.map(b => {
    return html`
      <${Table.Row}>
        <${Table.Cell}>${b.symbol ? b.symbol.toUpperCase() : b.token}</${Table.Cell}>
        <${Table.Cell}>${b.balance / Math.pow(10, b.precision)}</${Table.Cell}>
      </${Table.Row}>
    `;
  });
}

function BalanceTable({loggedInUser}) {

  const [balances, setBalances] = useState([]);
  const [user, setUser] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const onSearchSubmit = (e) => {
    e.preventDefault();
    setUser(searchTerm);
  };

  useEffect(()=>{
    setSearchTerm(loggedInUser);
    setUser(loggedInUser);
  }, [loggedInUser]);

  const getBalances = useCallback(async () => {
    if (user)
    {
      let res = await getJson(siblingUrl(null, thisApplet, "balances/" + user));
      setBalances(res);
    }
  }, [user]);

  const refreshBalances = useCallback((trace) => {
    getBalances().catch(console.error);
  }, [getBalances]);

  useEffect(()=>{
    refreshBalances();
  }, [refreshBalances])

  useEffect(()=>{
    addRoute("refreshbalances", transactionTypes.credit, refreshBalances);
  }, [refreshBalances]);

  return html`

    <${Segment}>
      <${Header} as='h2'>Token balances</${Header}>
      <${Form} fluid onSubmit=${onSearchSubmit}>
        <${Form.Group} widths=${1}>
          <${Form.Input}
            icon='user'
            iconPosition='left'
            placeholder='Search accounts...'
            name='name'
            value=${searchTerm}
            onChange=${(e) => {
              setSearchTerm(e.target.value);
            }}
          />
        </${Form.Group}>
      </${Form}>

      <${Table} celled striped>
        <${Table.Header}>
          <${Table.Row}>
            <${Table.HeaderCell}>token</${Table.HeaderCell}>
            <${Table.HeaderCell}>balance</${Table.HeaderCell}>
          </${Table.Row}>
        </${Table.Header}>

        <${Table.Body}>
          ${Rows(balances)}
        </${Table.Body}>
      </${Table}>
    </${Segment}>
  `;
}

function EmptyPanel() {
  return html`
    <${Segment}>
      Not yet implemented
    </${Segment}>
  `;
}

function GetMessage(props) 
{
  if (props.show === true)
  {
    return html`
      <${Message} positive header='Transfer successful' content='Your transfer to Bob was successful.' />
    `;
  }
  else return html``;
}


function SendPanel() {
  const [receiver, setReceiver] = useState("bob");
  const [token, setToken] = useState("PSI");
  const [amount, setAmount] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  const credited = useCallback( async (payload) =>{
    setShowSuccess(true);
    setTimeout(()=>{setShowSuccess(false);}, 5000);
  }, []);

  useEffect(()=>{
    addRoute("credited", transactionTypes.credit, credited);
  }, [credited]);

  const onSendSubmit = (e) => {
    e.preventDefault();
    const credit = async () => {

      push(transactionTypes.credit, [await action(
        thisApplet, "credit", 
        {
          tokenId: 1, 
          receiver: receiver, 
          amount: {value: amount },
          memo: {contents: "Test"},
        }
      )]);
    }
    credit().catch(console.error);
  };

  return html`
    <${Form} onSubmit=${onSendSubmit}>
      <${Form.Field}>
        <${Input} fluid label='To:' placeholder='Receiver account' disabled defaultValue='${receiver}'/>
      </${Form.Field}>
      <${Form.Field}>
        <${Input} fluid label='Token:' placeholder='Token' disabled defaultValue='${token}'/>
      </${Form.Field}>
      <${Form.Field}>
        <${Input} fluid label='Amount: $' placeholder='Amount' defaultValue='${amount}' onChange=${(e)=>{setAmount(e.target.value);}}/>
      </${Form.Field}>
      <${Form.Field}>
        <${Button} primary onClick=${onSendSubmit}>Send</${Button}>
      </${Form.Field}>
    </${Form}>
    <${GetMessage} show=${showSuccess}/>
  `;
}

const panes = [
  { 
    menuItem: 'Send', 
    render: () => {
      return html`<${Tab.Pane}><${SendPanel} /></${Tab.Pane}>`; 
    },
  },
  { 
    menuItem: 'Swap', 
    render: () => {
      return html`<${Tab.Pane}><${EmptyPanel} /></${Tab.Pane}>`;
    },
  },
];

function App() {

  const [user, setUser] = useState("");

  useEffect(()=>{
    // Todo - Timeout is used because sometimes the window.parentIFrame isn't loaded yet when 
    //  this runs. Should use a better fix for the race condition than a delay.
    setTimeout(()=>{ 
      getLocalResource(CommonResources.loggedInUser, setUser);
    }, 50);
  }, []);

  return html`
    <${Container}>
      <${Header} as='h1'>Wallet</${Header}>
      <${BalanceTable } loggedInUser=${user} />
      <${Tab} panes=${panes} />
    </${Container}>
  `;
}

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);
root.render(html`<${App} />`);

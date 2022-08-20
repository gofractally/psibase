import { useEffect, useState } from 'react'
import reactLogo from './assets/react.svg'
import './App.css'
import wait from 'waait'
// @ts-ignore
import { initializeApplet, action, query, operation, siblingUrl, getJson, setOperations } from "/common/rpc.mjs";


function App() {

  useEffect(() => {
    initializeApplet(async () => {
      const thisApplet = await getJson('/common/thiscontract') as string;

      setOperations([
        {
          id: "credit",
          exec: async ({ symbol, receiver, amount, memo }: { symbol: string, receiver: string, amount: string, memo: string }) => {

            //TODO: let tokenId = query("symbol-sys", "getTokenId", {symbol});
            let tokens = await getJson(await siblingUrl(null, thisApplet, "getTokenTypes"));
            let token = tokens.find((t: any) => t.symbolId === symbol.toLowerCase());
            if (!token) {
              console.error("No token with symbol " + symbol);
              return;
            }
            let tokenId = token.id;

            try {

              await action(thisApplet, "credit",
                {
                  tokenId,
                  receiver,
                  amount: { value: amount },
                  memo: { contents: memo },
                });
            } catch (e) {
              console.error('tx failed', e)
            }
          },
        }
      ]);
    });

    query("account-sys", "", "getLoggedInUser", {}, (loggedInUser: any) => {
      console.log('getLoggedInUser:', loggedInUser)
    });
    // wait(1000).then(() => {
    //   getBalance()
    // })
  }, [])

  const [userBalance, setUserBalance] = useState('');

  const getBalance = async () => {
    let res = await getJson(await siblingUrl(null, 'token-sys', "balances/" + 'alice')) as { account: string; balance: string; precision: number, token: number, symbol: string }[]
    return res;
  }
  const amountToSend = String(Number(33) * Math.pow(10, 8))

  const triggerTx = async () => {
    console.log(operation, 'is what is going to be hit...')
    operation('token-sys', '', 'credit', { symbol: 'PSI', receiver: 'bob', amount: amountToSend, memo: 'Working' })
    await wait(2000);
    const balances = await getBalance()
    console.log('balances fetched', balances)
    setUserBalance(balances[0].balance)
  };



  return (
    <div className="App">
      <div>
        <a href="https://vitejs.dev" target="_blank">
          <img src="/vite.svg" className="logo" alt="Vite logo" />
        </a>
        <a href="https://reactjs.org" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>alices balance is {userBalance}</h1>
      <div className="card">
        <button onClick={() => { triggerTx() }}>
          send 5 tokens to bob
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </div>
  )
}

export default App

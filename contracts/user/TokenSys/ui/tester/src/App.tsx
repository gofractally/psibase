import { useEffect, useState } from 'react'
import reactLogo from './assets/react.svg'
import './App.css'
import wait from 'waait'

import { initializeApplet, action, query, operation, siblingUrl, getJson, setOperations } from "common/rpc.mjs"
import useEffectOnce from './hooks/useEffectOnce'

function App() {

  useEffectOnce(() => {
    initializeApplet(async () => {
      const thisApplet = await getJson('/common/thiscontract') as string;

      setOperations([
        {
          id: "credit",
          exec: async ({ symbol, receiver, amount, memo }: { symbol: string, receiver: string, amount: string, memo: string }) => {

            console.log("credit hit!")
            //TODO: let tokenId = query("symbol-sys", "getTokenId", {symbol});
            let tokens = await getJson(await siblingUrl(undefined, thisApplet, "api/getTokenTypes"));
            let token = tokens.find((t: any) => t.symbolId === symbol.toLowerCase());
            if (!token) {
              console.error("No token with symbol " + symbol);
              return;
            }
            let tokenId = token.id;

            const value = String(Number(amount) * Math.pow(10, 8));

            try {
              await action(thisApplet, "credit",
                {
                  tokenId,
                  receiver,
                  amount: { value },
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
    wait(1000).then(() => {
      getBalance().then(setUserBalance)
    })
  }, [])

  const [userBalance, setUserBalance] = useState('');

  const fetchBalance = async () => {
    let res = await getJson(await siblingUrl(undefined, 'token-sys', "api/balances/" + 'alice')) as { account: string; balance: string; precision: number, token: number, symbol: string }[]
    return res;
  }

  const getBalance = async (current?: string, attempt = 1): Promise<string> => {
    const res = await fetchBalance();
    const parsedBalance = Number(Number(res[0].balance) / Math.pow(10, 8)).toString();

    if (!current || parsedBalance !== current || attempt > 3) return parsedBalance;
    console.log(`awaiting before checking balance again... Attempt: ${attempt}`);
    await wait(500);
    return getBalance(current, attempt + 1);
  }

  const triggerTx = async () => {
    console.log(operation, 'is what is going to be hit...');
    const beforeBalance = userBalance
    operation('token-sys', '', 'credit', { symbol: 'PSI', receiver: 'bob', amount: 3.5, memo: 'Working' })
    await wait(2000);
    const balance = await getBalance(beforeBalance)
    console.log('balances fetched', balance)
    setUserBalance(balance)
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
      <h1>Alices balance is {userBalance}</h1>
      <div className="card">
        <button onClick={() => { triggerTx() }}>
          send 4 tokens to bob
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

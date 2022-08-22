import { useState } from 'react'
import reactLogo from './assets/react.svg'
import './App.css'
import wait from 'waait'

import { initializeApplet, action, query, operation, siblingUrl, getJson, setOperations } from "common/rpc.mjs"
import useEffectOnce from './hooks/useEffectOnce'

interface Uint64 {
  value: string;
}
interface FungibleToken {
  id: number;
  ownerNft: number;
  inflation: {
    settings: {
      dailyLimitPct: string;
      dailyLimitQty: string;
      yearlyLimitPct: string;
    },
    stats: {
      avgDaily: string;
      avgYearly: string;
    }
  },
  config: {
    bits: number
  },
  precision: {
    value: number;
  },
  currentSupply: Uint64,
  maxSupply: Uint64;
  symbolId: string;
}

interface TokenBalance {
  account: string; balance: string; precision: number, token: number, symbol: string
}

class Contract {
  protected cachedApplet?: string

  protected async applet(): Promise<string> {
    if (this.cachedApplet) return this.cachedApplet;
    const appletName = await getJson('/common/thiscontract') as string;
    this.cachedApplet = appletName;
    return appletName;
  }

}

class TokenContract extends Contract {

  public async fetchTokenTypes() {
    const url = await siblingUrl(undefined, await this.applet(), "api/getTokenTypes");
    return getJson<FungibleToken[]>(url);
  }

  public async fetchBalances(user: string = 'alice') {
    const url = await siblingUrl(undefined, 'token-sys', `api/balances/${user}`)
    return getJson<TokenBalance[]>(url)
  }

  // idea:
  // @Operation('credit')
  // async credit ({ symbol, receiver, amount, memo }: { symbol: string, receiver: string, amount: string, memo: string }) => {

  // })

}

const tokenContract = new TokenContract();


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
            const allTokens = await tokenContract.fetchTokenTypes();
            const token = allTokens.find(t => t.symbolId === symbol.toLowerCase());
            if (!token) {
              console.error("No token with symbol " + symbol);
              return;
            }

            const value = String(Number(amount) * Math.pow(10, 8));

            try {
              await action(thisApplet, "credit",
                {
                  tokenId: token.id,
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


  const getBalance = async (current?: string, attempt = 1): Promise<string> => {
    const res = await tokenContract.fetchBalances();
    const parsedBalance = Number(Number(res[0].balance) / Math.pow(10, 8)).toString();

    const maxAttempts = 5;
    const tooManyAttempts = attempt > maxAttempts;
    if (!current || parsedBalance !== current || tooManyAttempts) {
      if (tooManyAttempts) {
        console.warn(`getBalance failed to return a different balance than the previously given ${current} after ${maxAttempts}`);
      }
      return parsedBalance
    };
    console.log(`awaiting before checking balance again... Attempt: ${attempt}`);
    await wait(500);
    return getBalance(current, attempt + 1);
  }

  const triggerTx = async () => {
    const beforeBalance = userBalance
    operation('token-sys', '', 'credit', { symbol: 'PSI', receiver: 'bob', amount: 3.5, memo: 'Working' })
    await wait(2000);
    const balance = await getBalance(beforeBalance)
    console.log('balances fetched', balance)
    setUserBalance(balance)
  };



  return (
    <div className="App">

      <h1>Alices balance is {userBalance}</h1>
      <div className="card">
        <button onClick={() => { triggerTx() }}>
          send 3.5 tokens to bob
        </button>
      </div>

    </div>
  )
}

export default App

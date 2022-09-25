import { useState } from "react";
import "./App.css";
import {
    initializeApplet,
    action,
    operation,
    siblingUrl,
    getJson,
    setOperations,
} from "common/rpc.mjs";
import useEffectOnce from "./hooks/useEffectOnce";
import { getLoggedInUser } from "./helpers";

class Contract {
    protected cachedApplet?: string;

    protected async applet(): Promise<string> {
        if (this.cachedApplet) return this.cachedApplet;
        const appletName = await getJson<string>("/common/thiscontract");
        this.cachedApplet = appletName;
        return appletName;
    }
}

// interface ApiResponse {
//   // expected response
// }

// class ExampleContract extends Contract {

//   public async fetchTokenTypes() {
//     const url = await siblingUrl(undefined, await this.applet(), "api/getTokenTypes");
//     return getJson<ApiResponse[]>(url);
//   }

// }

// const tokenContract = new ExampleContract();

function App() {
    const [currentUser, setCurrentUser] = useState("Not authenticated");

    useEffectOnce(() => {
        // initializeApplet(async () => {
        //   const thisApplet = await getJson('/common/thiscontract') as string;

        //   setOperations([
        //     {
        //       id: "credit",
        //       exec: async (params) => {

        //       },
        //     }
        //   ]);
        // });

        getLoggedInUser().then(setCurrentUser);
    }, []);

    const triggerTx = async () => {
        // operation('token-sys', '', 'credit', { symbol: 'PSI', receiver: 'bob', amount: 3.5, memo: 'Working' })
    };

    return (
        <div>
            <h1>Sample app</h1>
            <h2>Welcome {currentUser}</h2>
        </div>
    );
}

export default App;

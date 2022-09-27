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
import useEffectHmr from "./hooks/useEffectOnce";
import { getLoggedInUser } from "./helpers";


function App() {
    const [currentUser, setCurrentUser] = useState("Not authenticated");

    useEffectHmr(() => {

        getLoggedInUser().then(setCurrentUser);
    }, []);

    return (
        <div>
            <h1>Sample app</h1>
            <h2>Welcome {currentUser}</h2>
        </div>
    );
}

export default App;

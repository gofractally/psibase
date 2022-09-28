import { useState } from "react";
import "./App.css";
import {
    initializeApplet,
} from "common/rpc.mjs";
import useEffectHmr from "./hooks/useEffectOnce";
import { getLoggedInUser } from "./helpers";


function App() {
    const [currentUser, setCurrentUser] = useState("Not logged in");
    const [error, setError] = useState('')

    const fetchCurrentUser = async () => {
        setError('')
        try {
            const res = await getLoggedInUser();
            setCurrentUser(res)
        } catch (e) {
            setError(`Error loading logged in user ${e}`)
        }
    }

    useEffectHmr(() => {
        initializeApplet();
        fetchCurrentUser()
    }, []);

    return (
        <div className="p-4">
            <h1>Hello world!</h1>
            <h2>{error ? error : `Welcome ${currentUser}`}</h2>
        </div>
    );
}

export default App;

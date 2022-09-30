import { useState } from "react";
import "./App.css";
import {
    initializeApplet,
    setOperations
} from "common/rpc.mjs";
import useEffectHmr from "./hooks/useEffectOnce";
import { fetchTable, getLoggedInUser } from "./helpers";
import { Action, Op, Service } from "./contract";

class __contract__Service extends Service {

    @Action
    increment(num: number) {
        return { num }
    }

    @Op()
    async addNum(num: number) {
        this.increment(num);
    }

}

const violetService = new __contract__Service()


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
        initializeApplet(async () => {
            setOperations(violetService.ops)
        });
        fetchCurrentUser()
        fetchTable().then(setCount)

    }, []);


    const [count, setCount] = useState(0)


    const pushAddNumber = async () => {
        const previousCount = count;
        await violetService.addNum(num)
        const newCount = await fetchTable(previousCount)
        setCount(newCount)
    }


    const [num, setNum] = useState(0)
    return (
        <div className="p-4">
            <h1 className="py-4">Hello world!</h1>
            <h2>{error ? error : `Welcome ${currentUser}`}</h2>
            <div className="p-8">

                <h1>Count: {count}</h1>
                <input type="number" onChange={(e) => setNum(Number(e.target.value))} />
                <button className="py-2 rounded-lg text-white bg-blue-500 hover:bg-blue-600 px-4" onClick={() => { pushAddNumber() }}>Increment number!</button>
            </div>
        </div>
    );
}

export default App;

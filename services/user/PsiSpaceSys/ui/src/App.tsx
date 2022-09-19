import { useState } from "react";
import {
    initializeApplet,
    AppletId,
    query,
    setOperations,
} from "common/rpc.mjs";
import wait from "waait";

import useEffectOnce from "./hooks/useEffectOnce";
import { operations } from "./operations";
import { Heading } from "./components";
import { FilesManager } from "./components/files-manager/files-manager";

const accountSys = new AppletId("account-sys", "");

export const getLoggedInUser = () => {
    return query<void, string>(accountSys, "getLoggedInUser");
};

function App() {
    const [currentUser, setCurrentUser] = useState("");

    useEffectOnce(() => {
        initializeApplet(async () => {
            setOperations(operations);
            const loggedInUser = await getLoggedInUser();
            setCurrentUser(loggedInUser);
        });
    }, []);

    return (
        <div>
            <div className="flex items-center">
                <Heading tag="h2">My PsiSpace</Heading>
                <div className="ml-4 mt-2">manage your files, easily!</div>
            </div>

            {!currentUser ? (
                <p>Loading Logged User Account...</p>
            ) : (
                <FilesManager account={currentUser} />
            )}
        </div>
    );
}

export default App;

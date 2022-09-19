import { BrowserRouter, Route } from "react-router-dom";

import { appletPrefix } from "./config";
import { Applet, Dashboard, Nav } from "./views";
import { useApplets } from "./hooks/useApplets";

const App = () => {
    const { applets, currentUser, handleMessage } = useApplets();

    const [primaryApplet, ...subApplets] = applets;

    return (
        <div className="mx-auto max-w-screen-xl">
            <Nav currentUser={currentUser} />
            <BrowserRouter>
                <div>
                    <Route path="/" exact>
                        <Dashboard currentUser={currentUser} />
                    </Route>
                    <Route path={appletPrefix}>
                        <Applet
                            applet={primaryApplet}
                            handleMessage={handleMessage}
                        />
                    </Route>
                </div>
            </BrowserRouter>
            {subApplets.map((subApplet) => (
                <Applet
                    applet={subApplet}
                    handleMessage={handleMessage}
                    key={subApplet.appletId.name}
                />
            ))}
        </div>
    );
};

export default App;

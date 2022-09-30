import { BrowserRouter, Route } from "react-router-dom";

import { appletPrefix } from "./config";
import { Applet, Dashboard, Nav } from "./views";
import { useApplets } from "./hooks/useApplets";

const App = () => {
    const { primaryApplet, subApplets, currentUser, handleMessage } =
        useApplets();

    return (
        <div className="flex h-screen w-screen flex-col">
            <Nav currentUser={currentUser} />
            <BrowserRouter>
                <Route path="/" exact>
                    <Dashboard currentUser={currentUser} />
                </Route>
                <Route path={appletPrefix}>
                    <Applet
                        applet={primaryApplet}
                        handleMessage={handleMessage}
                    />
                </Route>
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

import { Outlet } from "react-router-dom";

import { NavHeader } from "./components/nav-header";
import { StatusBanner } from "./components/status-banner";

function App() {
    return (
        <div className="mx-auto max-w-screen-xl">
            <NavHeader />
            <div className="py-2">
                <StatusBanner />
            </div>
            <Outlet />
        </div>
    );
}

export default App;

import { Outlet } from "react-router-dom";

import { NavHeader } from "./components/nav-header";
import { ProducerKeyLockedBanner } from "./components/producer-key-locked-banner";
import { StatusBanner } from "./components/status-banner";

function App() {
    return (
        <div className="mx-auto max-w-screen-xl">
            <NavHeader />
            <div className="space-y-2 py-2">
                <StatusBanner />
                <ProducerKeyLockedBanner />
            </div>
            <Outlet />
        </div>
    );
}

export default App;

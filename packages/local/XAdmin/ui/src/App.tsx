import { Outlet } from "react-router-dom";

import { ProducerKeyLockedBanner } from "./components/producer-key-locked-banner";
import { StatusBanner } from "./components/status-banner";

function App() {
    return (
        <div className="max-w-screen-xl px-4 py-4">
            <div className="space-y-2 py-2">
                <StatusBanner />
                <ProducerKeyLockedBanner />
            </div>
            <Outlet />
        </div>
    );
}

export default App;

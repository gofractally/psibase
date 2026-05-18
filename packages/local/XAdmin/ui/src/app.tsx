import { Outlet } from "react-router-dom";

import { ProducerKeyLockedBanner } from "./components/producer-key-locked-banner";
import { StatusBanner } from "./components/status-banner";

function App() {
    return (
        <div className="p-4">
            <div className="mx-auto max-w-screen-xl">
                <div className="space-y-2 py-2">
                    <StatusBanner />
                    <ProducerKeyLockedBanner />
                </div>
                <Outlet />
            </div>
        </div>
    );
}

export default App;

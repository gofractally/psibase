import { Outlet } from "react-router-dom";

import { ProducerKeyLockedBanner } from "./components/producer-key-locked-banner";
import { StatusBanner } from "./components/status-banner";

function App() {
    return (
        <div className="px-4 pb-8 pt-2">
            <div className="mx-auto max-w-screen-xl">
                <div className="mb-4 space-y-2">
                    <StatusBanner />
                    <ProducerKeyLockedBanner />
                </div>
                <Outlet />
            </div>
        </div>
    );
}

export default App;

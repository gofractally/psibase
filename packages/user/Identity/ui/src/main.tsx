import React from "react";
import ReactDOM from "react-dom/client";

import "@shared/styles/globals.css";

import App from "./app.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@/components/theme-provider";

import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <App />
    </ThemeProvider>
);

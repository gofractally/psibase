import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "./router.tsx";
import { ThemeProvider } from "@/components/theme-provider";
import "./index.css";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={Router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
);

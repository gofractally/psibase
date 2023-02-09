import React from "react";
import ReactDOM from "react-dom";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Layout } from "layouts";
import { Options, SignIn, SignUp } from "pages";
import { StateProvider } from "store";

import "./styles/globals.css";
import { SelectAccount } from "pages/select/select-account";

export const queryClient = new QueryClient();

// TODO: 404 No-Match Route (https://reactrouter.com/docs/en/v6/getting-started/tutorial#adding-a-no-match-route)
const App = () => (
  <StateProvider>
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Options />} index />
            <Route path="/sign-up" element={<SignUp />} />
            <Route path="/select-account" element={<SelectAccount />} />
            <Route
              path="/sign-in"
              element={<SignIn addAccounts={() => {}} />}
            />
          </Route>
        </Routes>
      </Router>
    </QueryClientProvider>
  </StateProvider>
);

const container = document.getElementById("root");

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  container!
);

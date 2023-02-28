import React from "react";
import ReactDOM from "react-dom";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Modal from "react-modal";

import { Store } from "store";
import { Home, Account, Test } from "pages";
import { AccountMenu, CreateNewAddressModal } from "components/modals";
import { SampleModal } from "components/modals/sample-modal";

import "./styles/globals.css";

Modal.setAppElement("#root");

const App = () => (
    <Store.StateProvider>
        <Router>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/account" element={<Account />} />
                <Route path="/test" element={<Test />} />
            </Routes>
            <AccountMenu />
            <CreateNewAddressModal />
            <SampleModal />
        </Router>
    </Store.StateProvider>
);

const container = document.getElementById("root");

ReactDOM.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
    container!
);

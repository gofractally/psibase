import React from "react";
import { MemoryRouter } from "react-router-dom";
import "../src/styles/index.css";

export const decorators = [
    (Story) => (
        <MemoryRouter initialEntries={["/"]}>
            <Story />
        </MemoryRouter>
    ),
];

export const parameters = {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
        matchers: {
            color: /(background|color)$/i,
            date: /Date$/,
        },
    },
};

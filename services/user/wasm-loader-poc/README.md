# Project Structure Overview

This POC is a demo that would simulate a psibase app calling multiple plugins (wasm component files).

Just a vanilla html/js example.

The project is structured into distinct directories, each serving a specific purpose in the overall architecture:

1. **loader**

   - Contains the `index.html` which is embedded in the parent application via an iframe.
   - `src/index.ts` listens to requests from the parent application and dispatches the operations to the corresponding psibase app plugin (wasm component).

2. **parent**

   - Hosts `parent.html`, the main user interface with buttons and input fields for user interaction. It embeds loader.html in an iframe and dispatches user interactions to `loader/src/index.js`.
   - `src/index.js` is responsible for dispatching operations from the user interface to the loader/dispatcher script.

3. **server**

   - Simulates the psinode server, which will serve the wasms dinamically.
   - Contains the compiled Wasm files (`wasm1.wasm` and `wasm2.wasm`).
   - These are served using a simple HTTP server to be accessible by the loader.
   - Just run a `http-server` (installed globally via `npm`) to serve the wasm files.

4. **wasm1 and wasm2**
   - These directories contain the Rust source code (`lib.rs`) and the WebAssembly Interface Types (`world.wit`) for the Wasm modules.
   - Wasm1 and Wasm2 are separate modules, each responsible for specific arithmetic operations.

```sh
├── loader
│   ├── index.html
│   └── src
│       └── index.ts
├── parent
│   ├── index.html
│   └── src
│       └── index.js
├── server
│   ├── wasm1.wasm
│   └── wasm2.wasm
├── wasm1
│   ├── src
│   │   └── lib.rs
│   └── wit
│       └── world.wit
└── wasm2
    ├── src
    │   └── lib.rs
    └── wit
        └── world.wit
```

## Project setup

Requirements:

- `node v18.17.0`
- Rust and cargo-component (install using `cargo install cargo-component`)
- http-server npm package (install globally using npm install -g http-server)

To set up and run the WebAssembly modules along with the web application, follow the steps below:

```sh
# Checkout to the project's node version
nvm use

# Compile the WebAssembly Modules
# Navigate to wasm1 directory and build
cd wasm1
cargo component build --release

# Navigate to wasm2 directory and build
cd ../wasm2
cargo component build --release

# Set up the HTTP server to serve the Wasm files
# Navigate to the server directory
cd ../server

# copy the generated wasm files and paste it in this folder
cp ../wasm1/target/wasm32-wasi/release/wasm1.wasm wasm1.wasm
cp ../wasm2/target/wasm32-wasi/release/wasm2.wasm wasm2.wasm

# Start the server (this will serve wasm1.wasm and wasm2.wasm)
http-server . --cors
# server will be running on port 8080

# In a new terminal, set up the Loader/Dispatcher Web Application
# Navigate to the loader directory
cd loader

# Install JavaScript dependencies
yarn install

# Build the web application and start it
yarn build && yarn preview

# In a new terminal, set up the Parent Web Application
# Navigate to the parent directory
cd parent

# Install JavaScript dependencies
yarn install

# Build the web application and start it
yarn build && yarn preview
```

> Note: Ensure the server is running before opening parent.html as it depends on the Wasm files served by the server.

- Open The web application will be available at http://localhost:3000 in a web browser.
- Use the input fields to enter numbers.
- Click the operation buttons (Add, Multiply, Subtract, Divide) to perform calculations.
- The loader HTML inside the iframe will handle these operations using the corresponding Wasm modules and log the results to the console.

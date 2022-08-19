# applet-template

## Dev Instructions

-   clone directly into `[AppletSys]/ui` directory
-   update contract name at bottom of `vite.config.ts` (`plugins: [react(), psibase("token-sys")],`)
-   `yarn` to install dependencies
-   `yarn dev` and open on port `8081` for HMR!

## Build Instructions

-   building will create `dist` directory
-   `psibase upload-tree [contract-name] / ./dist`

## Making sure your built files are bootstrapped with new tester and new chain

-   Update contents of `DefaultTestChain.cpp` to include your new files
-   If you want new chains (not test chains) bootstrapped with the files, update `boot.rs`

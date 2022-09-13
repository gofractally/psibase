# applet-template

## Dev Instructions

-   `yarn` to install dependencies
-   `yarn dev` and open on port `8081` for HMR!

## Build Instructions

-   building will create `dist` directory
-   `psibase upload-tree psispace-sys / ./dist`

## Making sure your built files are bootstrapped with new tester and new chain

-   Update contents of `DefaultTestChain.cpp` to include your new files
-   If you want new chains (not test chains) bootstrapped with the files, update `boot.rs`

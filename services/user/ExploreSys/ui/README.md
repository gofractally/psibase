# ExploreSysUI

## Dev Instructions

-   update contract name at bottom of `vite.config.ts` (`plugins: [psibase("explore-sys")],`)
-   `yarn` to install dependencies
-   `yarn dev` and open `http://psibase.127.0.0.1.sslip.io:8081` for HMR!

## Build Instructions

- TODO:

## Making sure your built files are bootstrapped with new tester and new chain

-   Update contents of `DefaultTestChain.cpp` to include your new files
-   If you want new chains (not test chains) bootstrapped with the files, update `boot.rs`

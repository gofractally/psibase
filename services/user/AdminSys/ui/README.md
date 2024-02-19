# applet-template

## Dev Instructions

-   clone directly into `[AppletSys]/ui` directory
-   update contract name at bottom of `vite.config.ts` (`plugins: [react(), psibase("token-sys")],`)
-   `yarn` to install dependencies
-   `yarn dev` and open on port `8081` for HMR!

## Build Instructions

-   building will create `dist` directory
-   copy to `$PREFIX/share/psibase/services/admin-sys`

# Supervisor

WebAssembly modules, like [plugins](./plugins.md), always run in some host environment. For psibase app plugins executing in the browser, that host is called the supervisor. The supervisor is a core piece of infrastructure served by the psibase network that mediates all interactions between user interfaces and plugins. Furthermore, it is reponsible for fetching and dynamically linking all of a plugin's dependencies before the plugin is executed. 

## Host-provided capabilities

The supervisor gives plugins their capabilities. These capabilities could include, but are not limited to:

- [Synchronous calls between plugins](./plugins.md#synchronous-calls) - For modularizing app functionality
- Event subscription feeds - Allowing UIs to respond to server-side [events](./events.md)
- Facilitating user authentication for various tasks
- Facilitating authenticated sharing of private user data between plugins
- Client side peering - For exchange of data over WebRTC

## Architecture

The libary used by apps to access plugins will instantiate the supervisor in a hidden iframe within the app. This allows the browser to give the supervisor its own namespace that ensures any browser storage requirements are namespaced according to the supervisor domain rather than the app's domain.

```svgbob
.-------------------------------------------.
| 🔒 app1.psibase.tld                       |
|-------------------------------------------|
|                                           |
|   .-------------------------------------. |
|   | supervisor.psibase.tld [hidden]     | |
|  <-->                                   | |
|   |   .-----------------------------.   | |
|   |   | app1.psibase.tld/plugin     |   | |
|   |  <-->                           |   | |
|   |   |                             |   | |
|   |   '-----------------------------'   | |
|   |   .-----------------------------.   | |
|   |   | app2.psibase.tld/plugin     |   | |
|   |  <-->                           |   | |
|   |   |                             |   | |
|   |   '-----------------------------'   | |
|   '-------------------------------------' |
|                                           |
'-------------------------------------------'
```

### Dependency downloads

When a call is made to a plugin, the supervisor first downloads the plugin and parses it to understand its dependencies. It then downloads the entire plugin dependency tree.

### Import library generation

For each plugin, the supervisor dynamically generates a javascript library that proxies all calls to imported external plugin functionality through the supervisor. This allows the supervisor to maintain a callstack between all plugin calls, and to enforce any constraints that depend on the identity of the caller plugin (such as namespaced browser storage interactions). The supervisor combines this dynamically generated library with some static libraries for satisfying any imports to common functionality such as many of the [WASI](https://github.com/WebAssembly/WASI/blob/main/preview2/README.md) interfaces and other standard plugin imports.

### Transpilation

The supervisor then transpiles the WebAssembly components along with their imported libraries into core `wasm` modules and associated javascript libraries that can be used to interact with each plugin. This is because the execution of WebAssembly components is not yet supported directly in the browser.

### Bundling

Then the supervisor bundles the transpiled component and its libaries into an ES module. This module is then dynamically imported into browser memory.

### Initialization

Finally, the supervisor initializes each imported module with an object that defines various callbacks that can be used by the module to call back out into the host libraries, which is the final step in the preparation of each plugin. After this step, plugin functions are available to be called by apps or other plugins.

## Facilitating user interactions

There are various cases where it is necessary for a plugin to explicitly interact with the user.

When a plugin asks the supervisor to open a UI for user interaction, it provides a path relative to its own domain at which the UI can be retrieved. The supervisor then initiates opening this URL in another browser tab on behalf of the plugin.

> Note on user experience: Since modern browser do not allow pages to arbitrarily open new pages/tabs outside of handling a direct user interaction, the first time the supervisor requests to open a new window a user will need to explicitly enable popups from the supervisor in their browser. Due to the design of the supervisor running in its own domain, this is a one-time authorization by each user per device.

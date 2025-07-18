# Supervisor

WebAssembly modules, like [plugins](./plugins.md), always run in some host environment. For psibase app plugins executing in the browser, that host is called the supervisor. The supervisor is a core piece of infrastructure served by the psibase network that mediates all interactions between user interfaces and plugins. Furthermore, it is reponsible for fetching and dynamically linking all of a plugin's dependencies before the plugin is executed.

## Host-provided capabilities

Except for plugins hosted from the `host` service, plugins do not interact directly with the supervisor. Instead, plugins use the interfaces exposed by the `host` plugins (e.g. `host:common`, `host:prompt`, etc.) to access an allowed subset of the functionality of the platform on which they're running (e.g. browser functionality).

The host plugins provide plugins the ability to discover information about the current plugin execution context, such as the account name of the app responsible for making the current call.

Plugins are also able to make `get` and `post` requests to their own backend http servers. The interfaces exposed to plugins do not allow them to make generic web requests, so there is no risk of covert data exports to private servers. Requests can only be made to the plugin's own http server running on the same psibase network from which it was served.

Additionally, plugins can initiate direct interactions with the user through the `host:prompt` plugin. See the plugin documentation for details.

## Architecture

The library used by apps to access plugins will instantiate the supervisor in a hidden iframe within the app. This allows the browser to give the supervisor its own namespace that ensures any browser storage requirements are namespaced according to the supervisor domain rather than the app's domain.

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

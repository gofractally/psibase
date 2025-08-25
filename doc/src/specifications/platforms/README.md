# Platforms

A "platform" is the client-side context in which a user interacts with an app published in a psibase package. Some example platforms could include the web, a CLI program, a game console, etc.

# Platform independence

Most of the layers in the psibase app technology stack are platform independent. The part of a typical psibase app include:
1. Service
1. RPC/Http handlers
1. Plugin
1. User interface

Of these, the user-interface is the only part of the app that is specific to the platform. The service and rpc/http handlers run server-side (so are not relevant to the platform), and the plugin, though it runs client side, is compiled to wasm and runs in a platform-provided WebAssembly host.

Therefore, in the client-side portion of a psibase app, the cross-platform plugin is separated from the platform-native user interface. This separation allows for functionality to be reused between platforms, making the user-interfaces smaller/lighter than they would be otherwise.

# Platform-specific app requirements

The only part of a psibase app that is not cross-platform is the user interface. If a package published on a psibase network is intended to interface directly with a user, then it must deploy a user-interface that meets the specific requirements of the platform(s) on which it should be usable.

## Entrypoint

The user-interface must have a platform-specific entrypoint. The http server for the app must serve an asset at a pre-defined path that is the accessed from the platform.

## User prompts

User prompts are platform-specific elements of a user-interface that may be executed by a plugin. Therefore, though the plugin itself can run across platforms, the execution may fail at runtime if the platform host is unable to satisfy a requested user prompt. User prompts, like the entrypoint, are also typically handled by the app's http server serving an asset to facilitate the user-interaction at a predefined path.

# Platform-native host

The platform must provide a wasm host that runs natively on the platform (client-side). Among other things, this host is responsible for downloading all of the psibase app plugins (WebAssembly components) and preparing them for native execution. For example, since plugins are WebAssembly components, and components do not run natively (yet) in the web browser, the psibase web platform host must download the components, transpile them into core wasm and js, bundle them, and dynamically load them into the browser before plugin functionality can be executed in the browser.

As long as the interface between the application layer and the host doesn't change, new improvements and fixes can be deployed to the platform host without disruption to the functioning of the psibase apps.

## Security implications

The platform has a pivotal role in ensuring the environment in which plugins are run is secure. Plugins routinely work with private user data, including cryptographic keys, and if the platform is not implemented well, then users of the platform are at risk of data theft and other abuse. Users should generally not use arbitrary platforms unless they have high confidence in the security of the implementation.

# Reference platform implementations

## Web

Apps on a psibase network can be made available on the web platform by deploying the standard packages in the reference implementation. The web-browser native host in this default implementation is called "[supervisor](../app-architecture/supervisor.md)".

### Web platform - Entrypoint

Naturally, an app appears on the web platform at the path where it serves its web app. For most apps, this is the root path '/'.

### Web platform - User prompts

If your plugin requests a user prompt from the host, then your app must serve a corresponding webpage to handle the prompt at `/plugin/web/prompt/<prompt-name>`.

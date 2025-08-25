# Platform independence

The only part of a psibase app that is not cross-platform is the user interface. Because psibase apps have an architectural separation of the cross-platform component (plugin) from the platform-native component (user interface), the user interface components are smaller/lighter than they would be otherwise.

# Platform requirements

For psibase apps to be functional on a particular platform, the app must publish a user-interface that works natively on the platform. The paltform must provide a wasm host that runs natively on the platform (client-side). Among other things, this host is responsible for downloading all of the psibase app plugins (webassembly components) and preparing them for native execution. For example, since plugins are WebAssembly components, and components do not run natively (yet) in the web browser, the psibase web platform host must download the components, transpile them into core wasm and js, bundle them, and dynamically load them into the browser before plugin functionality can be executed in the browser.

Many changes and improvements to the platform host can be made without disruption to the functioning of the psibase apps.

# Security implications

The platform has a pivotal role in ensuring the environment in which plugins are run is secure. Plugins routinely work with private user data, including cryptographic keys, and if the platform is not implemented well, then users of the platform are at risk of data theft and other abuse. Users should generally not use arbitrary platforms unless they have high confidence in the security of the implementation.

# Supported platforms

## Web

The web platform is the first platform on which psibase apps are available. The web-browser native host in the reference implementation is called "[supervisor](../app-architecture/supervisor.md)".

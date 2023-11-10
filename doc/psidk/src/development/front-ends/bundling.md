# Bundling

## Security concerns

UI code is more powerful in psibase apps than it is in traditional web-apps because of its ability to make calls into [app interfaces](../../specifications/app-architecture/app-interfaces.md). If your application has its own service and app interface, your UI code can call nto your app interface, which can call into your service, which can change your application state without any explicit user confirmation.

Therefore, there exists the following attack vector for psibase apps: an npm package owner could maliciously update their package after it has been bundled in with psibase app front-ends, causing it to silently call into services as the user and cause chaos.

Some possible ways to avoid this risk:
1. Fork packages into a registry object that you control
2. Limit the use of external packages to those with good reputation

## Storage concerns

For each app that bundles React, for example, another copy of react will be stored on the shared psibase infrastructure. For saving costs on storage, it may be preferable to dynamically load more assets than would traditionally be done in a web application.

## App interfaces

When developing a front-end application that depends on [app interfaces](../../specifications/app-architecture/app-interfaces.md), it is highly recommended only to bundle javascript bindings that use the standard js libraries to interact with app interfaces, rather than bundling the app interfaces themselves. Otherwise, you risk giving the developer of the app-interface root access to your application by allowing them to silently call into your own app interface or service.

Read more about how to correctly call into app interfaces [here](../app-interfaces/reference/README.md).

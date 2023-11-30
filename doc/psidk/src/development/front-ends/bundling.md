# Bundling

## Security concerns

UI code is more powerful in psibase apps than it is in traditional web-apps because of its ability to make calls into [plugins](../../specifications/app-architecture/plugins.md). If your application has its own service and plugin, your UI code can call into your plugin, which can call into your service, which can change your application state without any explicit user confirmation.

Therefore, a package dependency bundled in with an application has the ability to exploit it. For this reason, developers should:
* Limit the packages that they depend on to those that they trust
* Be careful when updating your app with newer versions of those dependencies

## Plugins

When developing a front-end application that uses [plugins](../../specifications/app-architecture/plugins.md), it is highly recommended only to bundle the javascript bindings that interact with plugins through the supervisor, rather than directly bundling the plugin code into your app. Otherwise, the plugin is running in the same domain as your app and therefore effectively has root access and can silently make calls to your service from the user.

Read more about how to correctly call into plugins [here](../plugins/reference/README.md).

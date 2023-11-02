# psibase apps

psibase is designed primarily around the concept of hosting psibase apps. A "psibase app" is defined as an app that uses a psibase [service](../services/README.md) to serve a front-end. This forms a two-way trust relationship between the client and server, enabling silent interactivity with the server component just like traditional web-apps. But unlike traditional web-apps, the app is accessible via any infrastructure provider, state is replicated across the entire network, and connections are authenticated as in modern "web3" apps.

> *Note on external apps*:
> Though psibase is optimized for psibase apps, it is still possible to for independently served client code to interface with a psibase instance. These are called "external" apps, and you can read about them [here](./external-apps.md).


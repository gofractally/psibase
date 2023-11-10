# Psibase apps

Psibase can host the full application stack. Accounts on psibase can double as domain names relative to each infrastructure provider's root domain name. For example, if an infrastructure provider is hosting their node at `my-node.com`, then an account `alice` could host content that is retrievable at `alice.my-node.com/`. If another infrastructure provider on the same network is hosting at `another-node.com`, then Alice's same content is also available at `alice.another-node.com`. Each full node on the network is responsible for hosting full applications and their state, and providing RPC access for those trying to interact with psibase apps.

This design provides redundancy so that a community that self-hosts their applications using psibase is resilient to server unavailability and other faults. Furthermore, anyone can run their own infrastructure provider node and will effectively have all apps/services/state running on their local node, further eliminating dependency on external parties.

# Psibase app components

A psibase app is composed of various parts: 

* The database
* The service
* The app interface
* The user interface

Most of these components should already be familiar to app developers, because they're standard app components. Part of what makes psibase powerful is that it feels very similar to publishing a standard application, but it's empowered with additional capabilities.

## Database

On the server side, a psibase app has read/write access to a key/value database. This database is automatically synchronized between all infrastructure providers in the psibase network.

## Service

A service is a server-side component that defines an API for both authenticated and unauthenticated requests to the app. Authenticated requests are called "actions" and allow users of the app to update the app state.

Unauthenticated requests are read-only and could be traditional GET requests, GraphQL queries, or any other kind of HTTP request. The logic for handling these HTTP requests is completely defined by the service.

Psibase services are intended to take the place of the server-side component for traditional apps. 

### Limitations

All data stored in a service is public and accessible at least by the infrastructure providers and is therefore not suitable for storing private data unless it is first encrypted.

Services are unable to make web requests to external APIs and servers. Services are sandboxed and their functionality is limited to whatever is explicitly exposed to the service, such as the key/value API and the forwarding of web-requests into their RPC handling functions.

## App interface

A client-side component intedended to:
1. Wrap complicated interactions with one or more services into concise and user-friendly APIs
2. Manage and expose client-side local storage between apps
3. Facilitate all interactions between an app and the [Supervisor](./supervisor.md)

Psibase apps enjoy unprecedented modularity and allow apps to define both client and server-side functionality that can be reused by other apps. App interfaces are the innovation that allow this client-side modularity. See the [app interfaces](./app-interfaces.md) specification for more details.

## User interfaces

Every app needs a user interface. The difference between user-interfaces on psibase networks vs other user interfaces is that psibase app UIs are stored in the service database along with the other app state. This allows the UI to be replicated across the network and eliminates the web server as a potential point of centralization in an otherwise distributed app hosting architecture.

User interfaces can be written and bundled using regular UI development techniques and can then be uploaded to and served directly from services.

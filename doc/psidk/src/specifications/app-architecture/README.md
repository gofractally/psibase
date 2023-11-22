# Psibase apps

Psibase networks can host the full application stack. Rather than needing to rent your own web server for your app's server side component, you can simply create a psibase account which doubles as a domain name and can handle HTTP server requests. For example, if an infrastructure provider is hosting their psibase node at `my-node.com`, then an account `alice` could host content that is retrievable at `alice.my-node.com/`. Another psibase node on the same network will serve the same content at `alice.another-node.com`.

# Psibase app components

```svgbob
  .-------------------------------.
 /          ~ Server ~            /|
+--------------------------------+/|
| +----------------------------+ +/|
| |         Database           | +/|
| +-----^----------------^-----+ +/|
|       |                |       +/|
| +-----V-----+    +-----V-----+ +/|
| | Service 1 |<-->| Service 2 | +/|
| +--^--------+    +---------^-+ +/
'---/-------------------------\--'
   /                           \
  /                             \
 /                               \
/ .-----------------------------. \
| |         ~ Client ~          | |
| | +----------+  +----------+  |/
 \| | App1 intf|  | App2 intf|  /
  \ +-----^----+  +-----^----+ /|
  |\      |             |     / |
  | V-----V-------------V----V  |
  | |        Supervisor      |  |
  | +------------^-----------+  |
  |              |              |
  | +------------V-----------+  |
  | |      User interface    |  |
  | +------------------------+  |
  +-----------------------------+
  
```

A psibase app is composed of various parts: 

* The database
* The service
* The plugin
* The supervisor
* The user interface

## Database

On the server side, a psibase app has read/write access to a key/value database. This database is automatically synchronized between all infrastructure providers in the psibase network.

## Service

A service is a server-side component that defines an API for both authenticated and unauthenticated requests to the app. Authenticated requests are called "actions" and allow users of the app to update the app state.

Unauthenticated requests are read-only and could be traditional GET requests, GraphQL queries, or any other kind of HTTP request. The logic for handling these HTTP requests is completely defined by the service.

Psibase services are intended to take the place of the server-side component for traditional apps. 

### Limitations

All data stored in a service is public and accessible at least by the infrastructure providers. Therefore, services are not suitable for storing private data unless the data is encrypted.

Services are unable to make web requests to external APIs and servers. Services are sandboxed and their functionality is limited to whatever is explicitly exposed to the service, such as the key/value API and the forwarding of web-requests into their RPC handling functions.

## Plugin

Psibase service developers can build components that run client-side known as plugins. Plugins are responsible for:

1. Wrapping complicated interactions with one or more services into concise and user-friendly APIs
2. Managing and exposing client-side local storage between apps
3. Using the supervisor to send and receive messages to and from other plugins

Psibase apps enjoy unprecedented modularity and allow apps to define both client and server-side functionality that can be reused by other apps. Plugins are the innovation that allow this client-side modularity. See the [plugins](./plugins.md) specification for more details.

## Supervisor

Psibase apps are all loaded inside of a client-side component known as the supervisor. The supervisor is responsible for:
1. Instantiating apps
2. Facilitating all communication between UIs and plugins, plugins and other plugins, and plugins and services

See the [supervisor](./supervisor.md) specification for more details.


## User interfaces

Every app needs a user interface. The difference between user-interfaces on psibase networks vs other user interfaces is that psibase app UIs are stored in the service database along with the other app state. This allows the UI to be replicated across the network and eliminates the web server as a potential point of centralization in an otherwise distributed app hosting architecture.

User interfaces can be written and bundled using regular UI development techniques and can then be uploaded to and served directly from services.

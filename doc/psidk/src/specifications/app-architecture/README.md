# Psibase apps

Psibase networks can host the full application stack. Rather than needing to rent your own web server for your app's server side component, you can simply create an account on a psibase network which doubles as a domain name and can even handle HTTP server requests. For example, if an infrastructure provider is hosting their psibase node at `my-node.com`, then an account `alice` could host content that is retrievable at `alice.my-node.com/`. Another psibase node in the same psibase network hosted at `another-node.com` will serve the same content at `alice.another-node.com`.

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
| +--------^--+    +--------^--+ +/
'----------|----------------|----'
           |                |  
           +----------------+------+
                                   |
  .-----------------------------.  |
  |         ~ Client ~          |  |
  | +----------+  +----------+  |  |
  | | Plugin 1 |  | Plugin 2 |  |  |
  | +-----^----+  +-----^----+  |  |
  |       |             |       |  |
  | +-----V-------------V----+  |  |
  | |        Supervisor    <-|--|--|
  | +------------^-----------+  |  |
  |              |              |  |
  | +------------V-----------+  |  |
  | |      User interface  <-|--|--+
  | +------------------------+  |
  +-----------------------------+

  
```

A psibase app is composed of various parts: 

* The database
* The service
* The plugin
* The user interface

## Database

On the server side, a psibase app has read/write access to a key/value database. This database is automatically synchronized between all infrastructure providers in the psibase network.

## Service

A service is a server-side component that defines an API for both authenticated and unauthenticated requests to the app. 

* Authenticated requests are called "actions" and allow users of the app to update the app state.
* Unauthenticated requests are read-only and could be traditional GET requests, GraphQL queries, or any other kind of HTTP request. The logic for handling these HTTP requests is completely defined by the service.

Psibase services are intended to take the place of the server-side component for traditional apps. 

## Plugin

Psibase app developers build plugins to manage client-side user interactions and enable external integrations with their application. See the [plugins](./plugins.md) specification for more details.

## User interfaces

User-interfaces on psibase networks are stored in the service database along with all other app state. This implies that the UI is replicated across the network and it eliminates the web server as a potential point of centralization in an otherwise decentralized technology stack.

User interfaces can be created using standard UI development techniques and can then be uploaded to and served directly from services.

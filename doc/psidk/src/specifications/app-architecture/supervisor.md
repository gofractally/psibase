# Supervisor

The supervisor is the name of the client-side infrastructure that is the parent context for every psibase app. Psibase apps all run within the supervisor, and can interact with each other via message passing through the supervisor. The supervisor also provides core functionality to each psibase app, such as transaction packing, transaction submission, user authorization, transaction authorization, resource management, and more.

## Goals

1. Provide consistency to the user experience across the psibase app ecosystem
2. Provide a mechanism by which apps can share local client-side data
3. Enable app front-ends to interact with their back-ends without requiring prompts for user-authentication
4. Improve app modularity and connectedness by providing a straightforward mechanism to allow apps to leverage each others functionality

## How it works

The supervisor is served by each infrastructure provider at the root domain. Whenever a request is made to a root endpoint at the root domain, the client-side code for the supervisor is returned.

The supervisor is responsible for instantiating psibase apps and app interfaces in their own subdomains using iframes. If the root domain is requested with no specified subpath, then the supervisor may display a default "home page" for the psibase network. If the request specifies a subpath beginning with "`/applet/`", then the supervisor is responsible for instantiating the specified child app. 

For example, if `rootdomain.com/applet/myapp` is requested from a psibase infrastructure provider, then the supervisor is returned to the requesting client. When the supervisor loads, it sees that a subpath of `/applet/myapp` was specified, and will therefore embed an iframe into the browser interface whose `src` attribute is set to `myapp.rootdomain.com` in order to load the document stored at the root path of the service subdomain. If the request specifies any more specific subpath or query string, it is passed as a subpath to the service subdomain request (For example `rootdomain.com/applet/myapp/subpage2?var=foo` would result in a request for `myapp.rootdomain.com/subpage2?var=foo`).

Navigation to subpages from within psibase apps also propagate these history changes to the supervisor, which is responsible for updating the main browser URL. In this way, the browser URL and the iframe source remain synchronized.

## Capabilities

Supervisor facilitates:

* Client side peering using WebRTC
* Providing event subscription feeds for services to react to server-side [events](./events.md)
* [Inter-app communication](./app-interfaces.md#inter-app-communication)
* Constructing transactions from called actions
* Transaction signing and authorization ([Smart authorization](../blockchain/smart-authorization.md))
* Packing transactions into the [`fracpack`](../data-formats/fracpack.md) binary format

### Client-side peering

> ➕ TODO: Document client-side WebRTC-based peering capabilities facilitated by Supervisor.

### Event subscription feeds

Psibase apps may be interested in reacting to the emission of an [events](./events.md) from a service. In psibase networks, it is the supervisor that is responsible for providing an interface that allows a psibase app to subscribe to notifications for certain events.

The supervisor will poll the root domain to watch for events that have been subscribed to by any psibase apps. When an event occurs, it will notify the psibase app using an [Inter-app communication](#inter-app-communication) `"Event"` message. 

> Note: These events are polled at a particular frequency, such as once per second. This notification system is therefore not designed to benefit apps which have hard real time event notification requirements. For such requirements it is recommended to run your own infrastructure provider node.

### Inter-app communication

The supervisor is responsible for facilitating client-side communication between psibase app interfaces. To accomplish this, it listens for and responds to messages from apps that it instantiates within its managed iframes. All messaging happens via the [`Window.PostMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) API.

> ⚠️ For security, the supervisor should only listens for messages from an app whose origin matches one that it explicitly opened. Similarly, it should only send messages to apps whose origins it explicitly opened.

> ⚠️ For security, app interfaces should only listen for messages from the supervisor. Otherwise, an attacker app could instantiate the victim app within its own iframe and impersonate the supervisor.

#### Message handling

The supervisor listens for messages posted to its window messages with the following payload:

```json
{
    "message": {
        "type": "...", // Where the type is one of the supported supervisor message types
        "payload": "..." // Contents depends on the message type
    }
}
```

Supported supervisor message types:
* `"Action"` - Used when requesting the supervisor add an action to the pending transaction
* `"IAC"` - Used when calling a function defined in an app interface of another application
* `"IACResponse"` - A response to a prior IAC
* `"Event"` - A notification from the supervisor that an event to which your app subscribed has been emitted
* `"TransactionReceipt"` - A response with the payload returned by the node to whom a transaction was submitted
* `"ChangeHistory"` - A notification fired by a psibase app when its history changes, used for synchronizing the URL

Depending on the type of message, the payload is required to contain different parameters and the supervisor will behave differently.

> ➕ TODO: document supervisor message bodies

## Constructing transactions

A user interface can call an `"Action"` message on the supervisor, and the supervisor will attempt to package that service action into a transaction and submit it. However, this is not the optimal way for psibase apps to call service actions. 

It is far preferable for a user interface to call an `"IAC"` message on a supervisor, and let the app interfaces handle reqesting actions. Done this way, a transaction may be packed with multiple actions, which eases the authentication burden on the infrastructure providers who only need to run the authorization code once for the entire set of actions in the transaction, rather than once for each independent transaction. 

The supervisor will open a transaction at the start of a call to an app interface. App interfaces may send the `"Action"` message to the supervisor to attempt to add the action into the transaction. Furthermore, app interfaces may themselves use the `"IAC"` message to call into other app interfaces. The supervisor will handle packing all the transactions (depth-first) that were requested by each app interface accessed by the entire interaction.

An app interface signals that it is complete by sending the `"IACResponse"` message to the supervisor. Once the initial app interface function sends its `"IACResponse"` message, the transaction (which may now have many actions added to it) is considered closed to new actions.

> 🕓 Timeouts: If the supervisor does not receive an `"IACResponse"` message from an app interface in less than 100ms after it is initially called, then it will consider it failed. Caller app interfaces will be notified of the failure.

## Transaction authorization

Once the transaction construction is complete and new actions cannot be added, then it must be authorized using [smart authorization](../blockchain/smart-authorization.md) and submitted.

Authorizing a transaction is a multi-step process that requires aggregating one or more claims into the transaction, calculating the transaction hash, and then aggregating a proof for each claim (See [smart authorization](../blockchain/smart-authorization.md) docs for more details). Once the claims and proofs have been added into the transaction object the transaction is ready to be packed into a binary format and sent to an infrastructure provider node.

## Packing transactions

Transactions need to be packed into the [`fracpack`](../data-formats/fracpack.md) format before they are submitted. To do this, first, actions must be packed. To pack an action, supervisor will expect that the service on whom an action is being called handles requests made to `POST /pack_action/x`, wher `x` is the name of the action. The message body will include the action arguments, and the service is responsible for returning the packed `application/octet-stream` back to the supervisor, which can then include the packed actions in its transaction.

Supervisor must then use endpoints that are exposed by psibase infrastructure provider nodes: `POST /common/pack/Transaction` and `POST /common/pack/SignedTransaction`. These endpoints are used to pack the transaction, which can then be sent to the node.


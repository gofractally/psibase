# x-peers

The `x-peers` service manages connections to other nodes.

## HTTP Endpoints

| Method | URL           | Description                                                  |
|--------|---------------|--------------------------------------------------------------|
| `POST` | `/graphql`    | Handles GraphQL queries                                      |
| `POST` | `/connect`    | Connects to another node                                     |
| `POST` | `/disconnect` | Disconnects an existing peer connection                      |
| `GET`  | `/p2p`        | WebSocket endpoint that accepts connections from other nodes |


### GraphQL

```graphql
type Query {
    """
    A list of all peers that the node is currently connected to. The
    primary key is the connection ID. Takes the usual connection
    arguments.
    """
    peers(...): Connection<Peer>
}

type Peer {
    """
    The peer id. The id is unique, but may be reused after a
    connection is closed. Can be passed to /disconnect
    """
    id: Int!
    """
    The IP address/port of the peer. This may be empty if the
    connection has not yet been established.
    """
    endpoint: String!
    """
    All the URLs that have been used to connect to the peer.
    May come from other connections.
    """
    urls: [String!]!
    "The hostname used to connect or the hostnames reported by
    the peer"
    hosts: [String!]!
}
```

### connect

`/connect` creates a new p2p connection to another node. To set up a peer that will automatically connect whenever the server is running, use the [`peers` config field](../run-infrastructure/administration.md#server-configuration).

| Field | Type   | Description                                    |
|-------|--------|------------------------------------------------|
| `url` | String | The remote server, e.g. `"http://psibase.io/"` |

### disconnect

`/disconnect` closes an existing p2p connection. Note that if the connection was configured to connect automatically on either this node or the peer, it will try to reconnect immediately.

| Field | Type   | Description                       |
|-------|--------|-----------------------------------|
| `id`  | Number | The id of the connection to close |

### p2p

`/p2p` accepts incoming p2p connections. This requires the [`p2p` config option](../run-infrastructure/administration.md#server-configuration) to be enabled.

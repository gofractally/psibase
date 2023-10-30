# Administration

Much of the administration of an individual node can be done via the graphical user interface provided at `admin-sys.your_host.com`, where `your-host` is the public address of your psibase infrastructure node (e.g. psibase.127.0.0.1.sslip.io for local nodes). To learn more about the administration app, see the documentation on [admin-sys](../default-apps/admin-sys.md). For more complex administration requirements, psinode exposes many services and configuration options over an http interface.

## Node administrator services

The administrator API under `/native/admin` provides tools for monitoring and controlling the server. All APIs use JSON (`Content-Type` should be `application/json`). Authorization to access this API is controlled by the server's `admin-authz` configuration option.

| Method | URL                        | Description                                                                   |
|--------|----------------------------|-------------------------------------------------------------------------------|
| `GET`  | `/native/admin/status`     | Returns status conditions currently affecting the server                      |
| `POST` | `/native/admin/login`      | Returns a bearer token that can be used to access the admin API               |
| `POST` | `/native/admin/shutdown`   | Stops or restarts the server                                                  |
| `GET`  | `/native/admin/peers`      | Returns a JSON array of all the peers that the node is currently connected to |
| `POST` | `/native/admin/connect`    | Connects to another node                                                      |
| `POST` | `/native/admin/disconnect` | Disconnects an existing peer connection                                       |
| `GET`  | `/native/admin/keys`       | Returns a JSON array of the public keys that the server can sign for          |
| `POST` | `/native/admin/keys`       | Creates or imports a key pair                                                 |
| `GET`  | `/native/admin/config`     | Returns the current [server configuration](#server-configuration)             |
| `PUT`  | `/native/admin/config`     | Sets the [server configuration](#server-configuration)                        |
| `GET`  | `/native/admin/perf`       | Returns [performance monitoring](#performance-monitoring) data                |
| `GET`  | `/native/admin/log`        | Websocket that provides access to [live server logs](#websocket-logger)       |

### Server status

`/native/admin/status` returns an array of strings identifying conditions that affect the server.

| Status       | Description                                                                                                                                                                                                                                                                                                                                                                  |
|--------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `"slow"`     | `psinode` was unable to lock its database cache in memory. This may result in reduced performance. This condition can be caused either by insufficient physical RAM on the host machine, or by a lack of permissions. In the latter case, the command `sudo prlimit --memlock=-1 --pid $$` can be run before lauching `psinode` to increase the limits of the current shell. |
| `"startup"`  | `psinode` is still initializing. Some functionality may be unavailable.                                                                                                                                                                                                                                                                                                      |
| `"shutdown"` | `psinode` is shutting down. Some functionality may be unavailable.                                                                                                                                                                                                                                                                                                           |

`POST` to `/native/admin/shutdown` stops or restarts the server. The `POST` data should be JSON with any of the following options:

| Field     | Type    | Description                                                                                                                                                                                                                     |
|-----------|---------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `restart` | Boolean | If set to `true`, the server will be restarted                                                                                                                                                                                  |
| `force`   | Boolean | If set to `true`, the server will close all connections immediately without notifying the remote endpoint. Since this includes the connection used to send the shutdown, a request with `force` set may not receive a response. |
| `soft`    | Boolean | Applies to restarts only. If set to `true`, `psinode` will keep the current process image.                                                                                                                                      |

`POST` to `/native/admin/login` returns a bearer token that can be used to access the admin API. Requires bearer tokens to be enabled by the server configuration.

| Field  | Type        | Description                                                                                                                                |
|--------|-------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| `exp`  | NumericDate | The time at which the token expires in seconds since the UNIX epoch. If not specified, the token will expire 1 hour from the current time. |
| `mode` | String      | Should be either `"r"` or `"rw"`. If not specified, the token will have the same access rights as the client.                              |

| Field         | Type        | Description |
|---------------|-------------|-------------|
| `accessToken` | String      |             |
| `exp`         | NumericDate |             |
| `mode`        | String      |             |

### Peer management

`/native/admin/peers` lists the currently connected peers.

Each peer has the following fields:

| Field      | Type   | Description                                 |
|------------|--------|---------------------------------------------|
| `id`       | Number | A unique integer identifying the connection |
| `endpoint` | String | The remote endpoint in the form `host:port` |
| `url`      | String | (optional) The peer's URL if it is known    |

`/native/admin/connect` creates a new p2p connection to another node. To set up a peer that will automatically connect whenever the server is running, use the [`peers` config field](#server-configuration).

| Field | Type   | Description                                  |
|-------|--------|----------------------------------------------|
| `url` | String | The remote server, e.g. `"http://psibase.io/"` |

`/native/admin/disconnect` closes an existing p2p connection. Note that if the server drops below its preferred number of connections, it will attempt to establish a new connection, possibly restoring the same connection that was just disconnected.

| Field | Type   | Description                       |
|-------|--------|-----------------------------------|
| `id`  | Number | The id of the connection to close |

### Key ring

`GET` on `/native/admin/keys` lists the public keys that the server can sign for.

| Field     | Type   | Description                                                                                     |
|-----------|--------|-------------------------------------------------------------------------------------------------|
| `service` | String | The name of the service that verifies signatures made with this key                            |
| `rawData` | String | A hex string containing public key information. The interpretation depends on the verify service. |

`POST` to `/native/admin/keys` creates or uploads a new key pair. It returns the corresponding public key.

| Field     | Type   | Description                                                                                                                                                         |
|-----------|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `service` | String | The name of the verify service                                                                                                                                      |
| `rawData` | String | A hex string containing private key information. The interpretation depends on the verify service. If `rawData` is not present, the server will generate a new key. |

### Server configuration

`/native/admin/config` provides `GET` and `PUT` access to the server's configuration. Changes made using this API are persistent across server restarts. New versions of psibase may add fields at any time. Clients that wish to set the configuration should `GET` the configuration first and return unknown fields to the server unchanged.

| Field                    | Type              | Description                                                                                                                                                                                               |
|--------------------------|-------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `p2p`                    | Boolean           | Controls whether the server accepts incoming P2P connections.                                                                                                                                             |
| `peers`                  | Array             | A list of peer URLs that the server may connect to. To manage the active connections, see [peer management](#peer-management)                                                                             |
| `autoconnect`            | Number or Boolean | The target number of out-going connections. If set to true, the server will try to connect to all configured peers.                                                                                       |
| `producer`               | String            | The name used to produce blocks. If it is empty or if it is not one of the currently active block producers defined by the chain, the node will not participate in block production.                      |
| `host`                   | String            | The server's hostname.                                                                                                                                                                                    |
| `listen`                 | Array             | Interfaces that the server will listen on. Changes to the set of interfaces will take effect the next time the server starts.                                                                             |
| `listen[n].protocol`     | String            | One of `http`, `https`, or `local`                                                                                                                                                                        |
| `listen[n].address`      | String            | (`http` or `https`) An IP address that refers to a local interface                                                                                                                                        |
| `listen[n].port`         | Number            | (`http` or `https`) The TCP port number                                                                                                                                                                   |
| `listen[n].path`         | String            | (`local` only) A path to a local socket                                                                                                                                                                   |
| `tls`                    | Object            | The TLS context. Changes to the TLS context will take effect the next time the server starts.                                                                                                             |
| `tls.certificate`        | String            | The path to the server's certificate chain in PEM format                                                                                                                                                  |
| `tls.key`                | String            | The path to the file containing the private key for the server's certificate in PEM format                                                                                                                |
| `tls.trustfiles`         | Array             | A list of files containing trusted root CAs in PEM format.                                                                                                                                                |
| `services`               | Array             | A list of built in services. `host` is the virtual hostname for the service. If `host` ends with `.` the global `host` will be appended to it. `root` is a directory containing the content to be served. |
| `admin`                  | String            | Controls service access to the admin API. `*` allows access for all services.  `static:*` allows access for builtin services. The name of a service allows access for that service.                       |
| `admin_authz`            | Array             | Controls which clients are allowed to access the admin API                                                                                                                                                |
| `admin_authz[n].kind`    | String            | One of `any`, `loopback`, `ip`, or `bearer`                                                                                                                                                               |
| `admin_authz[n].mode`    | String            | One of `r` or `rw`                                                                                                                                                                                        |
| `admin_authz[n].address` | String            | (`ip` only) The client's IP address                                                                                                                                                                       |
| `admin_authz[n].key`     | String            | (`bearer` only) The key used to verify bearer tokens                                                                                                                                                      |
| `loggers`                | Object            | A description of the [destinations for log records](#logging)                                                                                                                                             |

Example:
```json
{
    "p2p": true,
    "peers": ["http://psibase.io/"],
    "producer": "prod",
    "host": "127.0.0.1.sslip.io",
    "listen": [
        {
            "protocol": "http",
            "address": "0.0.0.0",
            "port": 8080
        }
    ],
    "tls": {
        "certificate": "psibase.cert",
        "key": "psibase.key",
        "trustfiles": []
    },
    "services": [
        {
            "host": "localhost",
            "root": "/usr/share/psibase/services/admin-sys"
        }
    ],
    "admin": "builtin:*",
    "admin_authz": [{
        "mode": "rw",
        "kind": "bearer",
        "key": "swordfish"
    }],
    "loggers": {
        "console": {
            "type": "console",
            "filter": "Severity >= info",
            "format": "[{TimeStamp}] [{Severity}]: {Message}"
        },
        "file": {
            "type": "file",
            "filter": "Severity >= info",
            "format": "[{TimeStamp}]: {Message}",
            "filename": "psibase.log",
            "target": "psibase-%Y%m%d-%N.log",
            "rotationTime": "00:00:00Z",
            "rotationSize": 16777216,
            "maxSize": 1073741824
        },
        "syslog": {
            "type": "local",
            "filter": "Severity >= info",
            "format": "{Syslog:glibc}{Message}",
            "path": "/dev/log"
        }
    }
}
```

### Performance monitoring

`/native/admin/perf` reports an assortment of performance related statistics.

| Field          | Type   | Description                                                                                                                                                    |
|----------------|--------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `timestamp`    | Number | The time in microseconds since an unspecified epoch. The epoch shall not change during the lifetime of the server. Restarting the server may change the epoch. |
| `transactions` | Object | Transaction statistics                                                                                                                                         |
| `memory`       | Object | Categorized list of resident memory in bytes                                                                                                                   |
| `tasks`        | Array  | Per-thread statistics                                                                                                                                          |

The `transactions` field holds transaction statistics. It does not include transactions that were only seen in blocks.

| Field         | Type   | Description                                                                                                                      |
|---------------|--------|----------------------------------------------------------------------------------------------------------------------------------|
| `total`       | Number | The total number of transactions received                                                                                        |
| `unprocessed` | Number | The current transaction queue depth                                                                                              |
| `succeeded`   | Number | The number of transactions that succeeded                                                                                        |
| `failed`      | Number | The number of transactions that failed                                                                                           |
| `skipped`     | Number | The number of transactions skipped. This currently means that the node flushed its queue when it was not accepting transactions. |

The `memory` field holds a breakdown of resident memory usage.

| Field          | Type   | Description                                          |
|----------------|--------|------------------------------------------------------|
| `database`     | Number | Memory used by the database cache                    |
| `code`         | Number | Native executable code                               |
| `data`         | Number | Static data                                          |
| `wasmMemory`   | Number | WASM linear memory                                   |
| `wasmCode`     | Number | Memory used to store compiled WASM modules           |
| `unclassified` | Number | Everything that doesn't fall under another category. |

The `tasks` array holds per-thread statistics.

| Field        | Type   | Description                                                            |
|--------------|--------|------------------------------------------------------------------------|
| `id`         | Number | The thread id                                                          |
| `group`      | String | Identifies the thread pool that that thread is part of                 |
| `user`       | Number | The accumulated user time of the thread in microseconds                |
| `system`     | Number | The accumulated system time of the thread in microseconds              |
| `pageFaults` | Number | The number of page faults                                              |
| `read`       | Number | The total number of bytes fetched from the storage layer by the thread |
| `written`    | Number | The total number of bytes sent to the storage layer by the thread      |

Caveats:
The precision of time measurements may be less than representation in microseconds might imply. Statistics that are unavailable may be reported as 0.

```json
{
  "timestamp": "36999617055",
  "memory": {
    "database": "12914688",
    "code": "10002432",
    "wasmMemory": "7143424",
    "wasmCode": "7860224",
    "unclassified": "9269248"
  },
  "tasks": [
    {
      "id": 16367,
      "group": "chain",
      "user": "850000",
      "system": "190000",
      "pageFaults": "1",
      "read": "0",
      "written": "589824"
    },
    {
      "id": 16368,
      "group": "database",
      "user": "6370000",
      "system": "5750000",
      "pageFaults": "0",
      "read": "0",
      "written": "0"
    },
    {
      "id": 16369,
      "group": "http",
      "user": "120000",
      "system": "30000",
      "pageFaults": "0",
      "read": "0",
      "written": "0"
    }
  ],
  "transactions": {
    "unprocessed": "0",
    "total": "6",
    "failed": "2",
    "succeeded": "3",
    "skipped": "1"
  }
}
```

### Logging

- [Console Logger](#console-logger)
- [File Logger](#file-logger)
- [Local Socket Logger](#local-socket-logger)
- [Pipe Logger](#pipe-logger)
- [Websocket Logger](#websocket-logger)

The `loggers` field of `/native/admin/config` controls the server's logging configuration.

The log configuration is a JSON object which has a field for each logger. The name of the logger is only significant to identify the logger. When the log configuration is changed, if the new configuration has a logger with the same name and type as one in the old configuration, the old logger will be updated to the new configuration without dropping or duplicating any log records.

All loggers must have the following fields:

| Field    | Type             | Description                                                                                                            |
|----------|------------------|------------------------------------------------------------------------------------------------------------------------|
| `type`   | String           | The type of the logger: [`"console"`](#console-logger), [`"file"`](#file-logger), or [`"local"`](#local-socket-logger) |
| `filter` | String           | The [filter](psibase/logging.md#log-filters) for the logger                                                            |
| `format` | String or Object | Determines the [format](psibase/logging.md#log-fomatters) of log messages                                              |

Additional fields are determined by the logger type.

### Console logger

The console logger writes to the server's `stderr`.  It does not use any additional configuration.  There should not be more than one console logger.

### File logger

The file logger writes to a named file and optionally provides log rotation and deletion.  Multiple file loggers are supported as long as they do not write to the same files.

| Field          | Type    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                              |
|----------------|---------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `filename`     | String  | The name of the log file                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `target`       | String  | The pattern for renaming the current log file when rotating logs. If no target is specified, the log file will simply be closed and a new one opened.                                                                                                                                                                                                                                                                                                    |
| `rotationSize` | Number  | The file size in bytes when logs will be rotated                                                                                                                                                                                                                                                                                                                                                                                                         |
| `rotationTime` | String  | The time when logs are rotated. If it is a duration such as `"P8H"` or `"P1W"`, the log file will be rotated based on the elapsed time since it was opened. If it is a time, such as `"12:00:00Z"` or `"01-01T00:00:00Z"`, logs will be rotated at the the specified time, daily, monthly, or annually. Finally, a repeating time interval of the form `R/2020-01-01T00:00:00Z/P1W` (start and duration) gives precise control of the rotation schedule. |
| `maxSize`      | Number  | The maximum total size of all log files.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `maxFiles`     | Number  | The maximum number of log files.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `flush`        | Boolean | If set to true every log record will be written immediately.  Otherwise, log records will be buffered.                                                                                                                                                                                                                                                                                                                                                   |

`filename` and `target` can contain patterns which will be used to generate multiple file names. The pattern should result in a unique name or old log files may be overwritten. The paths are relative to the server's root directory.

| Placeholder                              | Description                                                   |
|------------------------------------------|---------------------------------------------------------------|
| `%N`                                     | A counter that increments every time a new log file is opened |
| `%y`, `%Y`, `%m`, `%d`, `%H`, `%M`, `%S` | `strftime` format for the current time                        |

Both rotation and log deletion trigger when any condition is reached.

When log files are deleted, the oldest logs will be deleted first. All files that match the target pattern are assumed to be log files and are subject to deletion.

Example:
```json
{
    "file-log": {
        "type": "file",
        "filter": "Severity >= info",
        "format": "[{TimeStamp}]: {Message}",
        "filename": "psibase.log",
        "target": "psibase-%Y%m%d-%N.log",
        "rotationTime": "00:00:00Z",
        "rotationSize": 16777216,
        "maxSize": 1073741824
    }
}
```

### Local Socket Logger

The socket type `local` writes to a local datagram socket. Each log record is sent in a single message. With an appropriate format, it can be used to communicate with logging daemons on most unix systems.

| Field  | Type   | Description     |
|--------|--------|-----------------|
| `path` | String | The socket path |

Example:
```json
{
    "syslog": {
        "type": "local",
        "filter": "Severity >= info",
        "format": "{Syslog:glibc}{Message}",
        "path": "/dev/log"
    }
}
```


### Pipe logger

The pipe logger sends log messages to the `stdin` of a subprocess. The format MUST include any necessary framing.

| Field     | Type   | Description                                                                                                |
|-----------|--------|------------------------------------------------------------------------------------------------------------|
| `command` | String | The command will be run as if by `popen(3)` with the working directory set to the server's root directory. |
|           |        |                                                                                                            |

The command SHOULD exit after receiving EOF. If it fails to do so, a configuration change that updates the command may terminate the previous command with a signal.

Examples:
```json
{
    "syslog": {
        "type": "pipe",
        "filter": "Severity >= info",
        "format": "{FrameDec:{Syslog:rfc5424}{Message}}",
        "command": "nc --send-only --ssl-verify --ssl-cert logcert.pem --ssl-key logkey.pem logs.psibase.io 6154"
    },
    "alert": {
        "type": "pipe",
        "filter": "Severity >= error",
        "format": "notify-send -a {Process} -i /usr/share/psibase/icons/psibase.svg '{Process} {Channel}' \"{Escape:$`\\\":{Message}}\"\n",
        "command": "/bin/sh"
    }
}
```

### Websocket logger

`/native/admin/log` is a websocket endpoint that provides access to server logs as they are generated. Each message from the server contains one log record. Messages sent to the server should be JSON objects representing the desired logger configuration for the connection.

| Field  | Type             | Description                                                                                                                                  |
|--------|------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| filter | String           | The [filter](psibase/logging.md#log-filters) for this websocket. If no filter is provided, the default is to send all possible log messages. |
| format | String or Object | The [format](psibase/logging.md#log-formatters) for log messages. If no format is provided, the default is JSON.                             |

The server begins sending log messages after it receives the first logger configuration from the client. The client can change the configuration at any time.  The configuration change is asynchronous, so the server will continue to send messages using the old configuration for a short period after client sends the update but before the server processes it.

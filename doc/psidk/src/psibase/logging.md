# Logging

- [Config File](#config-file)
  - [Console Logger](#console-logger)
  - [File Logger](#file-logger)
  - [Local Socket Logger](#local-socket-logger)
  - [Differences from JSON](#differences-from-json)
- [Log Filters](#log-filters)
- [Log Formatters](#log-formatters)

Logging in psinode can be configured at startup in the server's configuration file (found in `<DATABASE>/config`) or through the [HTTP API](../http.md#server-configuration) while the server is running.

## Config File

Each logger has a section in the config file called `[logger.<NAME>]`. The name of the logger is only significant to identify the logger.

```ini
[logger.stderr]
type   = console
filter = Severity >= info
format = [{TimeStamp}] [{Severity}]: {Message}
```

Each logger should have the following properties

| Property           | Description                                                                                                      |
|--------------------|------------------------------------------------------------------------------------------------------------------|
| `type`             | The type of the logger: [`console`](#console-logger), [`file`](#file-logger), or [`local`](#local-socket-logger) |
| `filter`           | The [filter](#log-filters) for the logger                                                                        |
| `format`           | Determines the [format](#log-fomatters) of log messages                                                          |
| `format.<Channel>` | Overrides the format for a specific channel                                                                      |


### Console logger

The console logger writes to the server's `stderr`.  It does not use any additional configuration.  There should not be more than one console logger.

### File logger

The file logger writes to a named file and optionally provides log rotation and deletion.  Multiple file loggers are supported as long as they do not write to the same files.

| Property       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                              |
|----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `filename`     | The name of the log file                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `target`       | The pattern for renaming the current log file when rotating logs. If no target is specified, the log file will simply be closed and a new one opened.                                                                                                                                                                                                                                                                                                    |
| `rotationSize` | The file size in bytes when logs will be rotated                                                                                                                                                                                                                                                                                                                                                                                                         |
| `rotationTime` | The time when logs are rotated. If it is a duration such as `"P8H"` or `"P1W"`, the log file will be rotated based on the elapsed time since it was opened. If it is a time, such as `"12:00:00Z"` or `"01-01T00:00:00Z"`, logs will be rotated at the the specified time, daily, monthly, or annually. Finally, a repeating time interval of the form `R/2020-01-01T00:00:00Z/P1W` (start and duration) gives precise control of the rotation schedule. |
| `maxSize`      | The maximum total size of all log files.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `maxFiles`     | The maximum number of log files.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `flush`        | If set to true every log record will be written immediately.  Otherwise, log records will be buffered.                                                                                                                                                                                                                                                                                                                                                   |

`filename` and `target` can contain patterns which will be used to generate multiple file names. The pattern should result in a unique name or old log files may be overwritten. The paths are relative to the server's root directory.

| Placeholder                              | Description                                                   |
|------------------------------------------|---------------------------------------------------------------|
| `%N`                                     | A counter that increments every time a new log file is opened |
| `%y`, `%Y`, `%m`, `%d`, `%H`, `%M`, `%S` | `strftime` format for the current time                        |

Both rotation and log deletion trigger when any condition is reached.

When log files are deleted, the oldest logs will be deleted first. All files that match the target pattern are assumed to be log files and are subject to deletion.

Example:
```ini
[logger.file]
type         = file
filter       = Severity >= info
format       = [{TimeStamp}]: {Message}
filename     = psibase.log
target       = psibase-%Y%m%d-%N.log
rotationTime = 00:00:00Z
rotationSize = 16 MiB
maxFiles     = 128
maxSize      = 1 GiB
```

### Local socket logger

The socket type `local` writes to a local datagram socket. Each log record is sent in a single message. With an appropriate format, it can be used to communicate with logging daemons on most unix systems.

| Property | Description     |
|----------|-----------------|
| `path`   | The socket path |

Example:
```ini
[logger.syslog]
type   = local
filter = Severity >= info
format = {Syslog:glibc}{Message}
path   = /dev/log
```

### Differences from JSON

The config file format is intended to allow manual editing and is therefore more permissive than the JSON format used by the [HTTP API](../http.md#logging), which is designed as a machine-to-machine interface.

- `rotationSize` and `maxSize` can specify units, such as KiB, MiB, GiB, etc. The JSON format requires a Number in bytes only.
- A per-channel `format` is split into multiple properties instead of fields of a subobject. This is a consequence of the flat structure of the INI format.
- TODO: currently rotationTime is pretty human-unfriendly

## Log Filters

Every logger has an associated filter. Filters determine whether to output any particular log record.

```
FILTER      ::= OR-FILTER
OR-FILTER   ::= AND-FILTER ( "or" AND-FILTER ) *
AND-FILTER  ::= ATTR-FILTER ( "and" ATTR-FILTER ) *
ATTR-FILTER ::= "not" ATTR-FILTER
ATTR-FILTER ::= "(" OR-FILTER ")"
ATTR-FILTER ::= ATTR-NAME
ATTR-FILTER ::= ATTR-NAME ATTR-OP ATTR-VALUE
ATTR-NAME   ::= alphanumeric chars
ATTR-VALUE  ::= chars that are neither whitespace nor any of "&|:{}()
ATTR-VALUE  ::= double-quoted string
```

Examples:
- Everything except debug messages: `Severity >= info`
- Everything about a specific peer: `PeerId = 42`
- Warnings, errors, and blocks: `Severity >= warning or Channel = block`

| Attribute        | Availability                                                                     | Predicates                      | Notes                                                                |
|------------------|----------------------------------------------------------------------------------|---------------------------------|----------------------------------------------------------------------|
| `BlockId`        | Log records related to blocks                                                    | `=`, `!=`                       |                                                                      |
| `Channel`        | All records                                                                      | `=`, `!=`                       | Possible values are `p2p`, `chain`, `block`, and `consensus`         |
| `Host`           | All records                                                                      | `=`, `!=`                       | The server's hostname.                                               |
| `PeerId`         | Log records related to p2p connections                                           | `=`, `!=`, `<`, `>`, `<=`, `>=` |                                                                      |
| `Process`        | All records                                                                      | `=`, `!=`                       | The program name (usually `psinode`)                                 |
| `ProcessId`      | All records                                                                      | `=`, `!=`, `<`, `>`, `<=`, `>=` | The server's pid                                                     |
| `RemoteEndpoint` | Log records related to HTTP requests, websocket connections, and p2p connections | `=`, `!=`                       |                                                                      |
| `Severity`       | All records                                                                      | `=`, `!=`, `<`, `>`, `<=`, `>=` | The value is one of `debug`, `info`, `notice`, `warning`, or `error` |
| `TimeStamp`      | All records                                                                      | `=`, `!=`, `<`, `>`, `<=`, `>=` | ISO 8601 extended format                                             |

## Log Formatters

Formatters specify how a log record is formatted. The following replacements are performed on the template string:
- `{attribute}`: If `attribute` is defined, expands to its textual representation. If `attribute` is not defined, expands to the empty string.
- `{attribute:format-spec}`: If `attribute` is defined, expands to the textual representation specified by `format-spec`. If `attribute` is not defined, expands to the empty string.
- `{?filter:subformat}`: If `filter` is true, expands `subformat`. Otherwise, expands to the empty string.
- `{?:subformat}`: If every attribute in `subformat` is defined, expands `subformat`. Otherwise, expands to the empty string.
- `{{`: Replaced with `{`
- `}}`: Replaced with `}` only outside of any expansion

Examples:
- `[{TimeStamp}] [{Severity}]: {Message}`
- `[{Timestamp}] [{Severity}]{?: [{RemoteEndpoint}]}: {Message}{?: {BlockId}}`

Formatters have several attributes beyond those available for filters including several compound formats.

| Attribute        | Availability                                                                     | Notes                                                                |
|------------------|----------------------------------------------------------------------------------|----------------------------------------------------------------------|
| `BlockHeader`    | Log records related to blocks                                                    |                                                                      |
| `BlockId`        | Log records related to blocks                                                    |                                                                      |
| `Channel`        | All records                                                                      | Possible values are `p2p`, `chain`, `block`, and `consensus`         |
| `Host`           | All records                                                                      | The server's hostname                                                |
| `Json`           |                                                                                  | Formats the entire log record as JSON                                |
| `Message`        |                                                                                  | The log message                                                      |
| `PeerId`         | Log records related to p2p connections                                           |                                                                      |
| `Process`        | All records                                                                      | The program name (usually `psinode`)                                 |
| `ProcessId`      | All records                                                                      | The server's pid                                                     |
| `RemoteEndpoint` | Log records related to HTTP requests, websocket connections, and p2p connections |                                                                      |
| `Severity`       | All records                                                                      | The value is one of `debug`, `info`, `notice`, `warning`, or `error` |
| `Syslog`         |                                                                                  | Formats a [syslog](#syslog) header.                                  |
| `TimeStamp`      | All records                                                                      | ISO 8601 extended format                                             |

### Syslog

The `Syslog` format creates a syslog header. It should be prepended to the desired message format with no space.

The `format-spec` for `Syslog` may contain the following options:
- format: one of `bsd` (equivalent to `rfc3164`), `rfc3164`, `rfc5424`, `glibc`. Default is `bsd`.
- facility: A syslog facility number or keyword.  Default is `local0`.

If both a format and facility are specified, they should be separated by a `;`.

Examples:
- `{Syslog:local1;rfc5424}`
- `{Syslog:glibc}`: Suitable for writing to `/dev/log` on linux systems.

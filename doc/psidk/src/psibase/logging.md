# Logging

- [Config File](#config-file)
  - [Console Logger](#console-logger)
  - [File Logger](#file-logger)
  - [Local Socket Logger](#local-socket-logger)
  - [Pipe Logger](#pipe-logger)
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

### Pipe logger

The pipe logger sends log messages to the `stdin` of a subprocess. The format MUST include any necessary framing.

| Property  | Description                                                                                                |
|-----------|------------------------------------------------------------------------------------------------------------|
| `command` | The command will be run as if by `popen(3)` with the working directory set to the server's root directory. |

The command SHOULD exit after receiving EOF. If it fails to do so, a configuration change that updates the command may terminate the previous command with a signal.

Examples:
```ini
[logger.syslog]
type    = pipe
filter  = Severity >= info
format  = {FrameDec:{Syslog:rfc5424}{Message}}
command = nc --send-only --ssl-verify --ssl-cert logcert.pem --ssl-key logkey.pem logs.psibase.io 6154
```

```ini
[logger.alert]
type    = pipe
filter  = Severity >= error
format  = "notify-send -a {Process} -i /usr/share/psibase/icons/psibase.svg '{Process} {Channel}' \"{Escape:$`\\\":{Message}}\"\n"
command = /bin/sh
```

### Differences from JSON

The config file format is intended to allow manual editing and is therefore more permissive than the JSON format used by the [HTTP API](../http.md#logging), which is designed as a machine-to-machine interface.

- `rotationSize` and `maxSize` can specify units, such as KiB, MiB, GiB, etc. The JSON format requires a Number in bytes only.
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

## Attributes

| Attribute        | Availability                      | Filter Predicates               | Notes                                                                            |
|------------------|-----------------------------------|---------------------------------|----------------------------------------------------------------------------------|
| `BlockHeader`    | blocks                            | None                            |                                                                                  |
| `BlockId`        | blocks                            | `=`, `!=`                       |                                                                                  |
| `Channel`        | All records                       | `=`, `!=`                       | Possible values are `http`, `p2p`, `chain`, `block`, and `consensus`             |
| `Escape`         | Formatters                        | N/A                             | Escapes a list of characters in a subformat.                                     |
| `FrameDec`       | Formatters                        | N/A                             | Prefixes a nested format with a decimal octet count                              |
| `Host`           | All records                       | `=`, `!=`                       | The system's FQDN (not the HTTP server's virtual hostname)                       |
| `Json`           | Formatters                        | N/A                             | Formats the entire log record as JSON                                            |
| `Message`        | Formatters                        | N/A                             | The log message                                                                  |
| `PeerId`         | p2p connections                   | `=`, `!=`, `<`, `>`, `<=`, `>=` |                                                                                  |
| `Process`        | All records                       | `=`, `!=`                       | The program name (usually `psinode`)                                             |
| `ProcessId`      | All records                       | `=`, `!=`, `<`, `>`, `<=`, `>=` | The server's pid                                                                 |
| `RemoteEndpoint` | HTTP requests and p2p connections | `=`, `!=`                       |                                                                                  |
| `RequestHost`    | HTTP requests                     | `=`, `!=`                       | The value of the `Host` header                                                   |
| `RequestMethod`  | HTTP requests                     | `=`, `!=`                       | The HTTP method of the request: `GET`, `POST`, etc.                              |
| `RequestTarget`  | HTTP requests                     | `=`, `!=`                       |                                                                                  |
| `ResponseBytes`  | HTTP requests                     | `=`, `!=`, `<`, `>`, `<=`, `>=` | The size of the response payload                                                 |
| `ResponseStatus` | HTTP requests                     | `=`, `!=`, `<`, `>`, `<=`, `>=` | The numeric status code of the response                                          |
| `ResponseTime`   | HTTP requests                     | `=`, `!=`, `<`, `>`, `<=`, `>=` | The elapsed time in microseconds spent handling the request                      |
| `Severity`       | All records                       | `=`, `!=`, `<`, `>`, `<=`, `>=` | The value is one of `debug`, `info`, `notice`, `warning`, `error`, or `critical` |
| `Syslog`         | Formatters                        | N/A                             | Formats a [syslog](#syslog) header.                                              |
| `TimeStamp`      | All records                       | `=`, `!=`, `<`, `>`, `<=`, `>=` | ISO 8601 extended format                                                         |

### Severity

`Severity` can be formatted as a string with the `s` *format-spec* or as a number with the `d` *format-spec*. The default is a string. If `Severity` is formatted as a number, the value will be interpreted as follows (matching syslog):

| Severity   | # |
|------------|---|
| `debug`    | 7 |
| `info`     | 6 |
| `notice`   | 5 |
| `warning`  | 4 |
| `error`    | 3 |
| `critical` | 2 |

Note that the numeric order is reversed. Comparisons in filters are ordered `debug < info < notice < warning < error < critical`.

### Escape

Characters can be backslash-escaped using `{Escape:chars:subformat}`. *chars* specifies the list of metacharacters to escape.

Example:
- Escape a JSON string: `{{{"message":"{Escape:\":{Message}}"}}}`
- Escape a shell command: ``foo "{Escape:\"`$:{Message}}"``

### Syslog

The `Syslog` format creates a syslog header. It should be prepended to the desired message format with no space.

The `format-spec` for `Syslog` may contain the following options:
- format: one of `bsd` (equivalent to `rfc3164`), `rfc3164`, `rfc5424`, `glibc`. Default is `bsd`.
- facility: A syslog facility number or keyword.  Default is `local0`.

If both a format and facility are specified, they should be separated by a `;`.

Examples:
- `{Syslog:local1;rfc5424}`
- `{Syslog:glibc}`: Suitable for writing to `/dev/log` on linux systems.

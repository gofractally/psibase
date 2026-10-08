# Host accounts plugin

`host:accounts` stores which account is logged in to each app, and which accounts are connected to each app, on this device. Other plugins call it for the current login. The accounts plugin and `host` call its admin interface to read and update those records.

`host:login-prompt` serves the login prompt (connect, import, and create) on the host subdomain.

## `api`

Any plugin may call `host:accounts/api`. It reports the login for the active top-level app — the app the user is directly interacting with.

| Function | Returns |
| --- | --- |
| `is-logged-in` | `true` when a user is logged in to the active app |
| `get-current-user` | That user's account name, or nothing when nobody is logged in |

## `active-app`

`host:accounts/active-app` changes the login and connections of the active top-level app. A function may be called by that top-level app or by its plugin. Some functions also allow a privileged caller:

| Function | Also callable by | Effect |
| --- | --- | --- |
| `login(user)` | — | Logs `user` in to the active app. The account must already be connected to that app, unless the app is `host`. |
| `logout` | `supervisor` | Logs out the active app. |
| `disconnect(account)` | `host` | Disconnects `account` from the active app, logging it out if it is the logged-in user. |
| `get-connected-accounts` | `supervisor` | Accounts connected to the active app. The user may only log in to one of these. |
| `connect-account` | — | Prompts the user to connect an account to the active app. |

`connect-account` does not accept a call from the `invite` sender. Only the top-level app or its plugin may call it.

## `admin`

`host:accounts/admin` reads and writes login and connection records for an app the caller names. Only the `accounts` plugin and `host` may call it.

| Function | Effect |
| --- | --- |
| `login(user, app)` | Logs `user` in to `app` and connects them to it. |
| `logout(app)` | Logs out whoever is logged in to `app`. |
| `connect(account, app)` | Connects `account` to `app`. |
| `disconnect(account, app)` | Disconnects `account` from `app`, logging it out if it is logged in. |
| `get-connected-accounts(app)` | Accounts connected to `app`. |
| `add-connected-app(user, app)` | Records that `user` has connected to `app`. |
| `remove-connected-app(user, app)` | Removes that record. |
| `get-connected-apps(user)` | Apps `user` has connected to. |

Accounts known on this device are the accounts connected to the `accounts` app. The accounts plugin reads that list with `get-connected-accounts`.

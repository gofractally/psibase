# HTTP requests

Requests made over HTTP to a psibase infrastructure provider must follow a particular URL encoding for them to be properly resolved. This document outlines the rules related to URL encoding.

## URL Encoding

The following attributes are used in the URL of a request:

| Position | Attribute | Prefix | Possible Values    | Description                                                      |
|----------|-----------|--------|--------------------|------------------------------------------------------------------|
|    1     | app       | n/a    | *                  | Specifies the app the name of the app requested by the user      |
|    2     | branch    | "b-"   | "b-< branch_tag >" | Specifies the branch of the chain state being accessed           |
|    2     | scope     | "s-"   | "s-local"          | Specifies the scope of the service being requested               |
|    3     | domain    | n/a    | *                  | Specifies the root domain of the node serving the infrastructure |
|    4     | path      | n/a    | *                  | Specifies the requested subpage of the requested app             |

A branch can only be specified when a request is not targeting the head branch. A scope can only be specified when a request is targeting the head branch.
The branch and scope are never both specified. Therefore the encoding results in the following request formats: `app.branch.domain/path` and `app.scope.domain/path`.
Most requests will use the default values for branch and scope (head branch in shared scope) and therefore most requests will have the simpler format: `app.domain/path`.

### Branch

Due to the psibase [database](./database.md) design, it is trivial for psibase networks to maintain multiple branches of chain state simultaneously. Because of this, when making an HTTP request to the chain, it is possible to query the state of the network as it exists on one of multiple state branches. A typical request will simply request the state on the head branch, which is the latest canonical version of the state. The head branch is the assumed default request target and therefore only requests made to alternative branches should specify a branch target.

Branches can be long-lived writeable alternatives to the head branch. These named branches may start identical to the head branch at a particular block height but can accept transactions and diverge into a separate state. Such branches may commonly be used as networks to deploy test code before using the head branch for production deployment. 

### Scope

Two state scopes exist for psibase networks: shared scope and local scope. Shared scope data is synchronized across all psibase nodes (chain state). The shared scope is the assumed default request target and therefore only requests made to the local scope should specify a scope target. Locally scoped data is local to the node at which it is written to or read from. For example, node administration and configuration data is specific to a particular node and that information is not synchronized across all nodes. Infrastructure providers can upload locally scoped services that manage node-specific data. They could even expose such functionality to users in order to give users local server space. Such local information is exposed over locally scoped queries.

To make a scoped query, the request URL format is `app.scope.domain/path`. Currently, the only alternative scope to the default shared scope is the local scope, which is identified by the value: "s-local". An administration app called "admin" could therefore be found at `admin.s-local.rootdomain.com/`.

> Note: Locally scoped data is not branchable.

### Attribute value prefixes

Different attributes have a special associated prefix for their values. For example, all values for the "branch" attribute begin with the prefix "b-" to indicate that the specified attribute is a value for the branch attribute. Importantly, no account name may use a hyphen character "-" as the second character in an account name to ensure that attribute values can never conflict with account names. For more information on account name rules, see the [account numbers data format specification](../data-formats/account-numbers.md).


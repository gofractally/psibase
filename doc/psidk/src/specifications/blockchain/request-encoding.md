# HTTP requests

Requests made over HTTP to a psibase infrastructure provider must follow a particular URL encoding for them to be properly resolved. This document outlines the rules related to URL encoding.

## URL Encoding

The request URL encoding is as follows: `app.branch.scope.domain/path`
This encoding includes three familiar attributes, namely the app, domain, and path. Additional attributes specific to psibase infrastructure are detailed below.

| Attribute | Prefix | Values<br>(Defaults **bold**)                                | Description                                                      |
|-----------|--------|--------------------------------------------------------------|------------------------------------------------------------------|
| app       | n/a    | *                                                            | Specifies the app the name of the app requested by the user      |
| branch    | "b-"   | **"b-head"**,<br>"b-< block_height >",<br>"b-< branch_tag >" | Specifies the branch of the chain state being accessed           |
| scope     | "s-"   | **"s-shared"**, "s-local"                                    | Specifies the scope in which to look for the app                 |
| domain    | n/a    | *                                                            | Specifies the root domain of the node serving the infrastructure |
| path      | n/a    | *                                                            | Specifies the requested subpage of the requested app             |

### Attribute value prefixes

Different attributes have a special associated prefix for their values. For example, all values for the "branch" attribute begin with the prefix "b-", in order to indicate that the specified attribute is a value for the branch attribute. Relatedly, no account name may have the dash character "-" as the first, second, or last character, which prevents attribute values from colliding with the name of the specified app (which is an account name). For more information on account name rules, see the [account numbers data format specification](../data-formats/account-numbers.md).

### Branch

Due to the psibase [database](./database.md) design, it is trivial for psibase networks to maintain multiple branches of chain state simultaneously. Because of this, when making an HTTP request to the chain, it is possible to query the state of the network as it exists on one of multiple state branches. A typical request will simply request the branch of the state at "b-head" which is the latest canonical version of the state. Requests made to the head branch may omit the branch attribute specifier, as it is the default and will be assumed.

To make a request at a particular block height, a request could specify a numeric branch, such as "b-1000". In this example, it would imply that the query is meant to apply to the state as of block height 1000. Requests made to branches at a block height are read only.

Lastly, the branch attribute may contain a name, which allows for long-lived write-enabled alternative state branches. These named branches start off at a particular block height, but can accept transactions and therefore may have state that is maintained separately from the main branch state. This allows for the rapid creation and deletion of test networks for development purposes.

### Scope

Two state scopes exist for psibase networks: shared scope and local scope. Shared scope is the scope for data that is synchronized across all psibase nodes (chain state). Locally scoped data is local to the node at which it is written to or read from. For example, node administration and configuration data is definitionally specific to a particular node, and therefore queries to such information would be locally scoped queries.

This is a generic design however and infrastructure providers can manually upload locally scoped services that manage node-specific data. This could enable users to run private services and store private data that is not synchronized across all nodes.

> ⚠️ Locally scoped data is not required to be branchable. and therefore if the scope attribute is specified as "s-local", then the only permitted branch value is "b-head". 

## URL resolution

Attributes encoded in the URL must always appear in the correct relative order: `app.branch.scope.domain/path`. However, some attributes such as branch and scope have default values and can therefore be omitted. 

If the branch is omitted, then the URL could have the following format: `app.scope.domain/path`. 
If the scope is omitted, then the URL could have the following format: `app.branch.domain/path`.
If both the branch and scope are omitted, then the URL could have the following format: `app.domain/path`.

It is never valid to encode these attributes in a different relative order, such as `scope.branch.app.domain/path`.

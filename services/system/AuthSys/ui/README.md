# AuthSys Applet

Authorization with public key applet.

The only responsibility of this applet is to serve queries about accounts and their pub keys, and vice-versa. It abstracts away applets calling the `auth-sys` service directly.

Main queries:

- `accWithKey`: Retrieve all the accounts for a given Pub key.
- `getClaim`: Retrieve the standard claim, used to sign transactions, for a given account.

## Development Workflow

Since it's a super basic and simple applet, we decided to leave it as a single vanilla javascript file.

The workflow is simply updating the js file and running `psibase upload-tree r-auth-sys / .`

This will upload the index.js and you will be able to test the changes in your psibase instance right away.
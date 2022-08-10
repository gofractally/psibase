# Operations

Applets must define, in a structured way, the operations they know how to perform. If done correctly, these operations can not only be used internally to the applet who owns the operations, but these operations could be called by any other applet loaded client-side on a user's browser. This allows one applet to create an interface defining interactions with its own local state, its application, other applet local state, or other applications. This drastically increases the level of abstraction it is possible for applets on a psibase blockchain to provide each other.

## Example implementation

To create a new symbol, it is necessary to first transfer an amount of tokens to the symbol application that is sufficient to cover the cost of the new tokens. But rather than forcing every other applet for whom the process of creating a new symbol is part of their own operational requirements to independently learn the process needed to create a symbol, the symbol application can simply define an operation that performs the correct sequence to create a symbol. If it does so, then it effectively abstracts the complexity of symbol creation from the outside world, who now only need to know that they call the "Create" operation on the symbol applet.

```javascript
// applet/symbol-sys/index.js

let operations = [
    {
        id: "create",
        exec: ({symbol}) => {
            let maxDebit = getCurrentSymbolPrice() * 1.1;
            op("token-sys", "credit", {
                symbol: "PSI",
                receiver: "symbol-sys",
                maxDebit,
                memo: "To cover cost of symbol creation",
            };
            action("symbol-sys", "create", {symbol, maxDebit});
        },
    }
];

setOperations(operations);
```

In the implementation of the symbol-sys:create operation, there is not only a call to the symbol-sys:create action on the symbol application, but there is also a call to the token-sys:credit operation, which is an operation defined by another applet. In Psibase, tokens and symbols are separate. In fact, tokens know nothing about symbols, but there is a standard symbol application which knows about tokens. So if one was to attempt to credit tokens to another by submitting an action directly to the token application, it would first be necessary to look up the tokenId associated with a particular symbol in the symbol application. But in this case, the token-sys applet defined an operation that accepts a symbol in order to hide that complexity from all other applets.

Hopefully this starts to elucidate how the concept of client-side operations can be used to improve abstraction and composability in psibase applications & applets beyond what is possible in other blockchain development environments.

## Security

An applet is served by its own application, and it is therefore capable of executing actions on its own application on behalf of the user without asking for explicit permission. It's functionally an extension of the application itself.

But, for an applet to execute actions and operations on another applet would require that the user gives permission to the originating applet to act on their behalf within the context of another applet.

The core infrastructure provided for applet development handles these permission requests automatically so that applets can simply focus on writing the logic that performs the necessary operations. All permissions management and authentication will be automatically facilitated for all applets that are served from a psibase chain.

## Execution

It is posisble that the user may be using an applet to construct a multisignature transaction, rather than to use the applet themselves. In this case, the actions and action scripts that are specified during the depth-first traversal of the operations are added to a queue and pushed to the multisignature contract, where they can be viewed & signed asynchronously by all listed parties.

Once again, the core infrastructure provided for applet development automatically allows users to enter and exit multisignature mode at will, and differentiates transactions that are expected to be signed and pushed as the user, and transactions that are destined for the multisignature contract. Applets that are deployed on and served from the psibase chain will automatically be embedded in an environment that makes this execution mode trivial for end users.

This means that an application cannot be written to expect a callback when a transaction is pushed and executed, because it is possible that the transaction will never execute if the user is in multisignature mode. Instead, an applet should design their application to subscribe and respond to particular events.

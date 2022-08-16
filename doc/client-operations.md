# Operations

Applets must define, in a structured way, the operations they know how to perform. If done correctly, these operations can not only be used internally to the applet who owns the operations, but these operations could be called by any other applet loaded client-side on a user's browser. This allows one applet to create an interface defining interactions with its own local state, its application, other applet local state, or other applications. This drastically increases the level of abstraction it is possible for applets on a psibase blockchain to provide each other.

## Example implementation

To create a new symbol, it is necessary to first transfer an amount of tokens to the symbol application that is sufficient to cover the cost of the new tokens. But rather than forcing every other applet for whom the process of creating a new symbol is part of their own operational requirements to independently learn the process needed to create a symbol, the symbol application can simply define an operation that performs the correct sequence to create a symbol. If it does so, then it effectively abstracts the complexity of symbol creation from the outside world, who now only need to know that they call the "Create" operation on the symbol applet.

```javascript
// applet/symbol-sys/index.js

initializeApplet(async () => {
    setOperations([
        {
            id: "create",
            exec: ({symbol}) => {
                let maxDebit = getCurrentSymbolPrice() * 1.1;
                operation("token-sys", "", "credit", {
                    symbol: "PSI",
                    receiver: "symbol-sys",
                    amount: maxDebit,
                    memo: "To cover cost of symbol creation",
                };
                action("symbol-sys", "create", {symbol, maxDebit});
            },
        }
    ]);
});
```

In the above sample implementation of the symbol-sys:create operation, there is not only a call to the symbol-sys:create action on the symbol application, but there is also a call to the token-sys:credit operation, which is an operation defined by another applet. In Psibase, tokens and symbols are separate. In fact, tokens know nothing about symbols, but there is a standard symbol application which knows about tokens. So if one was to attempt to credit tokens to another by submitting an action directly to the token application, it would first be necessary to look up the tokenId associated with a particular symbol in the symbol application. But in this case, the token-sys applet defined an operation that accepts a symbol in order to hide that complexity from all other applets.

Hopefully this starts to elucidate how the concept of client-side operations can be used to improve abstraction and composability in psibase applications & applets beyond what is possible in other blockchain development environments.

## Security

An applet is served by its own application, and it is therefore capable of executing actions on its own application on behalf of the user without asking for explicit permission. It's functionally an extension of the application itself.

But, for an applet to execute actions and operations on another applet would require that the user gives permission to the originating applet to act on their behalf within the context of another applet.

The core infrastructure provided for applet development handles these permission requests automatically so that applets can simply focus on writing the logic that performs the necessary operations. All permissions management and authentication will be automatically facilitated for all applets that are served from a psibase chain.

## Execution

It is possible that the user may be using an applet to construct a transaction, rather than wanting to construct it and immediately push it to chain (for example if trying to propose a multisignature transaction).

This means that an applet should not be written to expect a callback when an operation is executed. Instead, an applet should design their application to poll the blockchain for state updates, or subscribe and handle particular events.


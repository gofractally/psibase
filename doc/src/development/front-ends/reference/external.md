# External apps

An external app is any client code that is not served from a psibase service. This implies that the client code is untrusted, and therefore it cannot interact with any of the client-side psibase infrastructure, such as that which automates transaction packing, digital signing, or transaction submission. All of this must be done manually by those building external apps.

External apps are also unable to use [plugins](../../../specifications/app-architecture/plugins.md).

## Basic transaction execution script

This example works directly in the browser without bundling, transpiling, etc.

<!-- prettier-ignore -->
```html
<!DOCTYPE html>
<html>
    <body>
        See the console

        <!-- type="module" enables es6 imports -->
        <!-- it also allows using await outside of functions -->
        <script src="script.mjs" type="module"></script>
    </body>
</html>
```

<!-- prettier-ignore -->
```js
// Use these if your script is NOT hosted by psinode:
import { getTaposForHeadBlock, signAndPushTransaction }
    from 'http://psibase.localhost:8080/common/common-lib.js';
const baseUrl = 'http://psibase.localhost:8080';

try {
    const transaction = {
        tapos: {
            ...await getTaposForHeadBlock(baseUrl),
            // expire after 10 seconds
            expiration: new Date(Date.now() + 10000),
        },
        actions: [
            {
                sender: "sue",          // account requesting action
                service: "example",     // service executing action
                method: "add",          // method to execute
                data: {                 // arguments to method
                    "a": 0,
                    "b": 0
                }
            }
        ],
    };
    const privateKeys = [
        'PVT_K1_2bfGi9rYsXQSXXTvJbDAPhHLQUojjaNLomdm3cEJ1XTzMqUt3V',
    ];

    // Don't forget the await!
    const trace = await signAndPushTransaction(baseUrl, transaction, privateKeys);

    console.log("Transaction executed");
    console.log("\ntrace:", JSON.stringify(trace, null, 4));
} catch (e) {
    console.log("Caught exception:", e.message);
    if (e.trace)
        console.log(JSON.stringify(e.trace, null, 4));
}
```

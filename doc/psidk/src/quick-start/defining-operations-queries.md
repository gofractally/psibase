# Defining Operations and Queries

In psibase, projects include a **service** similar to smart contracts on other blockchains and **applets**.

An applet is a front end deployed to the blockchain which acts as an interface to the service, able to trigger transactions or it can be entirely independent, simply used as a personal website.

Applets have the ability to set their own operations and queries, read about this at [James article](applet/inter-applet-communication.md)

The React generator comes with an example of using the Service class and its decorators to make defining these as easy as possible.

```
import { Service } from "common/rpc";

class MyCoolService extends Service {

    @Action
    increment(num: number) {
        return { num }
    }

    @Op()
    async addNum(num: number) {
        this.increment(num);
    }

}

const myCoolService = new MyCoolService();

setOperations(myCoolService.operations);
setQueries(myCoolService.queries);


```

Methods with @Action on them explicitly declare actions available on their Service counterparts, therefore the name of the method must also match that of the service, they're expected to return an object

Methods with @Op() are operations, we can name the operation by passing a string to the function, e.g. `@Op('operationName')`, if undefined, it will default to the name of the method.

Other applets may call your operations, which are typically more developer friendly than directing calling the actions of a Service.

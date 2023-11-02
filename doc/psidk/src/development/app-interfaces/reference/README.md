> ⚠️ **No reference implementation yet exists**: Below is tentative pseudocode and can serve as a rough implementation guide.

# App interfaces code reference

## An election service example

This is written in Rust, compiled to wasm, and published to a particular account.

Transactions that are submitted to psinode contain actions that specify the service, action name, and parameters necessary to execute this code server-side.

```rs
    /// Vote for a candidate
    #[action]
    fn vote(candidate: AccountNumber) {
        let current_time = get_current_time();
        check(current_time >= get_election().voting_start_time, "election has not started");
    
        let table = VotesTable::new();
        let voter = get_sender();
        let voting_record = table.get_index_pk().get(&(voter));
        check_none(voting_record, "voter has already submitted a vote");

        // Update voter record
        let new_voting_record = VotingRecord {
            voter,
            candidate,
            voted_at: current_time,
        };
        table.put(&new_voting_record).unwrap();

        // Update candidate record
        let mut candidate_record = get_candidate(candidate);
        candidate_record.votes += 1;
        CandidatesTable::new().put(&candidate_record).unwrap();
    }
```

## Election app interface

This is written in Rust, compiled to WebAssembly, and published to a specific endpoint of a particular service. 

For example, assuming that an infrastructure provider for a psibase network was hosting client-side code at `my-psibase-node.com`, then if an interface was published to the "interface" endpoint of a service called "election," it could be retrieved by making a GET request to `election.my-psibase-node.com/interface`. Ultimately, this interface is executed client-side, just like the other UI components.

The js libraries provided to the UI developers make it easy to call into app interfaces, abstracting the process of requesting and instantiating the wasm.


```rs
    #[interface_action]
    fn vote(candidate: AccountNumber)
    {
        let voter = get_sender();
        get_service().vote(candidate);

        // Cache vote client-side in browser local storage
        save_vote(voter, sender);
    }

    #[interface_action]
    fn get_vote()
    {
        return get_vote(voter); // Returns cached local storage object
    }
```

Notice that `get_vote` is a call that can be made into the app interface that does not call any service actions. It simply queries local browser storage to return a cached value. Although app interfaces are written in rust, they have full access to the browser environment including local storage.

## Calling the app interface

This front-end code could be bundled and served from the root path of a particular service (Such as `election.my-psibase-node.com/`).

### Using standard IAC libraries

The simplest way for front-end javascript code to call into an app interface would be to use the functions provided by the common psibase js library:

```js
import { iac } from "@psibase/lib";

try {
    await iac.call("election", "vote", { candidate: "bob"});
} catch (e) {
    console.error(e);
}

```

This method, however, has no type-checking or autocomplete. For a typesafe solution, continue reading the next section.

### Using custom bindings

In the future, it will be possible for the app interface developer to easily generate javascript and/or typescript bindings that will facilitate making calls into an interface. These bindings wrap standard IAC library calls and provide type checking for the underlying app-interface function calls. These can then be deployed to a package registry like npm and used by any standard front-end bundler.

In this case, the front-end code may look more like:

```js
import { election } from "@electionapp/lib"

try {
    await election.vote("bob");
} catch (e) {
    console.error(e);
}

```

> ⚠️ Important note on security:
> 
> If you're an app developer, it is important that you are the one to generate the javascript/typescript bindings for calling into any app interface you require. This is because if bundle code written by another developer into your UI code with the intention of making interface calls, a malicious developer could exploit your app by making calls into *your* app interface, which can be done silently (without confirmation from the user).
> 
> In other words, it is safe to generate app interface bindings and use them to call into third-party app interfaces. It is not safe to use third-party generated app interface bindings.
> 
> To read more about the strategy for app bundling in psibase, read the [bundling](../../front-ends/bundling.md) docs.



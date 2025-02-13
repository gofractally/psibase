# Permissions

## Developer Guide

Nomenclature: An app `Caller` makes a call to `Callee`'s plugin for some protected data.

```
await supervisor.functionCall({
    service: "callee",
    intf: "queries",
    method: "getPrivateData",
    params: [],
});
```

`Callee` calls out to the Permissions plugin (via is_permitted method) to see if the user wants `Caller` to have access to `Callee`'s data.
is_permitted() is a default permissions implementation, grants full access or no access, and is scoped to a Caller->Callee pair. In other words, `Callee` calls is_permitted() from any method that needs to protect sensitive data and if approved, `Caller` now gets access to all of `Callee`'s protected data.
What constitutes protected data is up to `Callee`.

```
impl Queries for CalleePlugin {
    fn get_private_data() -> Result<String, Error> {
        // ask Permissions if this caller can call this app (callee)
        let caller = get_sender_app().app.unwrap();
        // return data or error if not permitted
        if !is_permitted(&caller)? {
            return Err(ErrorType::QueryNotPermittedError().into());
        }
        Ok(String::from("private data"))
    }
}
```

The user's granting of permission is stored in local storage and future calls to is_permitted() for the `Caller`->`Callee` pair are auto-approved.

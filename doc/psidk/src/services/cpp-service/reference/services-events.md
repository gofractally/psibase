# C++ Services and Events

- [Defining a service](#defining-a-service)
- [Reserved action names](#reserved-action-names)
- [Calling other services](#calling-other-services)
- [Defining events](#defining-events)
- [Recursion safety](#recursion-safety)
- [psibase::getSender]
- [psibase::getReceiver]
- [psibase::Service]
  - [psibase::Service::emit]
  - [psibase::Service::events]
- [psibase::Actor]
- [psibase::to]
- [psibase::from]
- [psibase::EventEmitter]
- [psibase::EventReader]

## Defining a service

To define a service:

- Make a struct or class. It may optionally publicly inherit from [psibase::Service] to gain the [psibase::Service::emit] and [psibase::Service::events] convenience methods.
- Define or declare the set of methods
- Reflect the methods using `PSIO_REFLECT`. Only reflected methods become actions; these are available for transactions and for other services to call using [psibase::Actor] or [psibase::call].

### Example without convenience base class:

```c++
struct MyService
{
   // The account this service is normally installed on. This definition
   // is optional.
   static constexpr auto service = psibase::AccountNumber("myservice");

   void        doSomething(std::string_view str);
   std::string somethingElse(uint32_t x, psibase::AccountNumber y);
};

PSIO_REFLECT(MyService,
             method(doSomething, str),
             method(somethingElse, x, y))
```

### Example with convenience base class:

```c++
struct MyService: psibase::Service<MyService>
{
   // The account this service is normally installed on. This definition
   // is optional.
   static constexpr auto service = psibase::AccountNumber("myservice");

   void        doSomething(std::string_view str);
   std::string somethingElse(uint32_t x, psibase::AccountNumber y);
};

PSIO_REFLECT(MyService,
             method(doSomething, str),
             method(somethingElse, x, y))
```

## Reserved action names

Psibase standard action names end with `Sys` or `_Sys` (case insensitive). You should avoid this suffix
when defining your own actions if they're not implementing one of the
[existing standards](../../standards/actions.html) documented in this book. If you don't avoid it, your
service may misbehave when future standards are adopted. e.g. don't create an action named `emphasys`.

## Calling other services

[psibase::Actor] supports calling other services. [psibase::to] and [psibase::from] simplify obtaining an actor.

To call another service:

```c++
auto result =
    psibase::to<OtherServiceClass>(otherServiceAccount)
    .someMethod(args...);
```

If `OtherServiceClass` defines `service` within it, you may omit the account name:

```c++
auto result =
    psibase::to<OtherServiceClass>()
    .someMethod(args...);
```

## Defining events

See the following for a description of the various types of events:

- [psibase::DbId::historyEvent]
- [psibase::DbId::uiEvent]
- [psibase::DbId::merkleEvent]

To define events for a service, declare the event functions as below, then reflect them using the 4 macros below. Each of the `History`, `Ui`, and `Merkle` structs must be present and reflected, even when they don't have any events declared within.

After you have defined your events, use [psibase::Service::emit] to emit them and [psibase::Service::events] to read them.

```c++
struct MyService: psibase::Service<MyService> {
   struct Events {
      // Events which live a long time
      struct History {
         // These functions don't need implementations;
         // they only define the interface
         void myEvent(uint32_t a, std::string s);
         void anotherEvent(psibase::AccountNumber account);
      };

      // Events which live a short time
      struct Ui {
         void updateDisplay();
      };

      // Events which live in Merkle trees
      struct Merkle {
         void credit(
            psibase::AccountNumber from,
            psibase::AccountNumber to,
            uint64_t amount);
      };
   };
};

PSIBASE_REFLECT_EVENTS(MyService)

PSIBASE_REFLECT_HISTORY_EVENTS(
   MyService,
   method(myEvent, a, s),
   method(anotherEvent, account))

PSIBASE_REFLECT_UI_EVENTS(
   MyService,
   method(updateDisplay))

PSIBASE_REFLECT_MERKLE_EVENTS(
   MyService,
   method(credit, from, to, amount))
```

## Recursion safety

- By default, services support recursion. TODO: make it opt-in instead.
- When a service is called multiple times within a transaction, including recursively, each action gets a fresh `DerivedService` instance. However, it runs in the same WASM memory space as the other executing actions for that service. Global variables and static variables are shared.
- Potential hazards to watch out for:
  - If a call modifies member variables within a Service instance, other calls aren't likely to see it.
  - If a call modifies global or static variables, this will effect both the other currently-executing calls, and subsequent calls.
  - If a call modifies the database, other currently-executing calls will see the change only if they read or re-read the database.
  - When you call into any service; assume it can call you back unless you opted out of recursion. TODO: make it possible to opt out of recursion.
  - Calling other services while you are iterating through the database can be dangerous, since they can call back into you, causing you to change the database.

The notes above use the following definition of "call":

- Using actions in a transaction to enter the service
- Using [psibase::call] or [psibase::Actor] to enter or reenter the service

Calling service methods directly (e.g. `this->doSomething()`) don't count in this definition.

{{#cpp-doc ::psibase::getSender}}
{{#cpp-doc ::psibase::getReceiver}}
{{#cpp-doc ::psibase::Service}}
{{#cpp-doc ::psibase::Actor}}
{{#cpp-doc ::psibase::to}}
{{#cpp-doc ::psibase::from}}
{{#cpp-doc ::psibase::EventEmitter}}
{{#cpp-doc ::psibase::EventReader}}

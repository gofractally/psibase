#pragma once

#include <concepts>
#include <psibase/AccountNumber.hpp>
#include <psibase/Actor.hpp>
#include <psibase/Table.hpp>

namespace psibase
{
   template <typename T>
   concept DefinesService =
       std::same_as<std::decay_t<decltype(T::service)>, psibase::AccountNumber>;

   namespace internal
   {
      extern AccountNumber sender;
      extern AccountNumber receiver;
   }  // namespace internal

   /// The account which authorized the currently-executing action
   inline AccountNumber getSender()
   {
      return internal::sender;
   }

   /// The account which received the currently-executing action
   inline AccountNumber getReceiver()
   {
      return internal::receiver;
   }

   /// Services should inherit from this
   ///
   /// Template arguments:
   /// - `DerivedService`: the most-derived service class that inherits from `Service`
   ///
   /// #### Defining a service
   ///
   /// To define a service:
   /// - Make a struct or class which publicly inherits from `Service`
   /// - Define or declare the set of methods
   /// - Reflect the methods using `PSIO_REFLECT`. Only reflected methods become actions; these are available for transactions and for other services to call using [call] or [Actor].
   ///
   /// Example:
   ///
   /// ```c++
   /// struct MyService: psibase::Service<MyService>
   /// {
   ///    void        doSomething(std::string_view str);
   ///    std::string somethingElse(uint32_t x, psibase::AccountNumber y);
   /// };
   ///
   /// PSIO_REFLECT(MyService,
   ///              method(doSomething, str),
   ///              method(somethingElse, x, y))
   /// ```
   ///
   /// #### Reserved action names
   ///
   /// psibase standard action names end with `Sys` or `_Sys` (case insensitive). You should avoid this suffix
   /// when defining your own actions if they're not implementing one of the
   /// [existing standards](../../standards/actions.html) documented in this book. If you don't avoid it, your
   /// service may misbehave when future standards are adopted. e.g. don't create an action named `emphasys`.
   ///
   /// #### Calling other services
   ///
   /// [Actor] supports calling other services. [Service::at] and [Service::as] simplify obtaining an actor.
   ///
   /// To call another service:
   ///
   /// ```c++
   /// auto result = at<OtherServiceClass>(otherServiceAccount).someMethod(args...);
   /// ```
   ///
   /// To call into this service recursively:
   ///
   /// ```c++
   /// auto result = as().someMethod(args...);
   /// ```
   ///
   /// You rarely need to do this. It has higher overhead than simply calling your own functions directly.
   ///
   /// #### Defining events
   ///
   /// See the following for a description of the various types of events:
   /// - [DbId::historyEvent]
   /// - [DbId::uiEvent]
   /// - [DbId::merkleEvent]
   ///
   /// To define events for a service, declare the event functions as below, then reflect them using the 4 macros below. Each of the `History`, `Ui`, and `Merkle` structs must be present and reflected, even when they don't have any events declared within.
   ///
   /// After you have defined your events, use [Service::emit] to emit them and [Service::events] to read them.
   ///
   /// ```c++
   /// struct MyService: psibase::Service<MyService> {
   ///    struct Events {
   ///       // Events which live a long time
   ///       struct History {
   ///          // These functions don't need implementations;
   ///          // they only define the interface
   ///          void myEvent(uint32_t a, std::string s);
   ///          void anotherEvent(psibase::AccountNumber account);
   ///       };
   ///
   ///       // Events which live a short time
   ///       struct Ui {
   ///          void updateDisplay();
   ///       };
   ///
   ///       // Events which live in Merkle trees
   ///       struct Merkle {
   ///          void credit(
   ///             psibase::AccountNumber from,
   ///             psibase::AccountNumber to,
   ///             uint64_t amount);
   ///       };
   ///    };
   /// };
   ///
   /// PSIBASE_REFLECT_EVENTS(MyService)
   ///
   /// PSIBASE_REFLECT_HISTORY_EVENTS(
   ///    MyService,
   ///    method(myEvent, a, s),
   ///    method(anotherEvent, account))
   ///
   /// PSIBASE_REFLECT_UI_EVENTS(
   ///    MyService,
   ///    method(updateDisplay))
   ///
   /// PSIBASE_REFLECT_MERKLE_EVENTS(
   ///    MyService,
   ///    method(credit, from, to, amount))
   /// ```
   ///
   /// #### Recursion safety
   ///
   /// - By default, services support recursion. TODO: make it opt-in instead.
   /// - When a service is called multiple times within a transaction, including recursively, each action gets a fresh `DerivedService` instance. However, it runs in the same WASM memory space as the other executing actions for that service. Global variables and static variables are shared.
   /// - Potential hazards to watch out for:
   ///   - If a call modifies member variables within a Service instance, other calls aren't likely to see it.
   ///   - If a call modifies global or static variables, this will effect both the other currently-executing calls, and subsequent calls.
   ///   - If a call modifies the database, other currently-executing calls will see the change only if they read or re-read the database.
   ///   - When you call into any service; assume it can call you back unless you opted out of recursion. TODO: make it possible to opt out of recursion.
   ///   - Calling other services while you are iterating through the database can be dangerous, since they can call back into you, causing you to change the database.
   ///
   /// The notes above use the following definition of "call":
   ///
   /// - Using actions in a transaction to enter the service
   /// - Using [call] or [Actor] to enter or reenter the service
   ///
   /// Calling service methods directly (e.g. `this->doSomething()`) don't count in this definition.
   template <typename DerivedService>
   class Service
   {
     public:
      /// Call a service
      ///
      /// Template arguments:
      /// - `Other`: the receiver's class
      ///
      /// Returns an [Actor] for calling `receiver` using the current service's authority.
      ///
      /// Example use:
      ///
      /// ```c++
      /// auto result = at<OtherServiceClass>(otherServiceAccount).someMethod(args...);
      /// ```
      template <typename Other = DerivedService>
      Actor<Other> at(AccountNumber receiver)
      {
         return Actor<Other>(getReceiver(), receiver);
      }

      /// Call a service
      ///
      /// Template arguments:
      /// - `Other`: the receiver's class
      ///
      /// Returns an [Actor] for calling `receiver` using the current service's authority.
      /// This version sets receiver to `Other::service`; this works if `Other` defined
      /// a const member named `service` which identifies the account that service is
      /// normally deployed on.
      ///
      /// Example use:
      ///
      /// ```c++
      /// auto result = at<OtherServiceClass>().someMethod(args...);
      /// ```
      template <DefinesService Other = DerivedService>
      Actor<Other> at()
      {
         return at<Other>(Other::service);
      }

      /// Call a service
      ///
      /// - If `u` is `0` (the default), then use this service's authority ([getReceiver]).
      /// - If `u` is non-0, then use `u`'s authority. Non-priviledged services may only use their own authority.
      ///
      /// In either case, defaults to sending actions to this service (recursion).
      ///
      /// See [Service::at]; it covers the majority use case.
      ///
      /// Example use:
      ///
      /// ```c++
      /// auto result =
      ///   as(userAccount)
      ///   .at<OtherServiceClass, otherServiceAccount>()
      ///   .someMethod(args...);
      /// ```
      Actor<DerivedService> as(AccountNumber u = AccountNumber())
      {
         if (u == AccountNumber())
            return {getSender(), getReceiver()};
         return {u, getReceiver()};
      }

      /// Emit events
      ///
      /// The following examples use the example definitions in [Defining Events](#defining-events). After you have defined your events, you can use `emit` to emit them. Examples:
      ///
      /// - `auto eventANumber = emit().history().myEvent(a, s);`
      /// - `auto eventBNumber = emit().ui().updateDisplay();`
      /// - `auto eventCNumber = emit().merkle().credit(from, to, amount);`
      ///
      /// These functions return a `psibase::EventNumber`, aka `uint64_t`, which uniquely identifies the event. This number supports lookup; see [Service::events].
      EventEmitter<DerivedService> emit() const
      {
         return EventEmitter<DerivedService>(getReceiver());
      }

      /// Read events
      ///
      /// The following examples use the example definitions in [Defining Events](#defining-events). After you have defined your events, you can use `events` to read them. Examples:
      ///
      /// * `auto eventAArguments = events().history().myEvent(eventANumber).unpack();`
      /// * `auto eventBArguments = events().ui().updateDisplay(eventBNumber).unpack();`
      /// * `auto eventCArguments = events().merkle().credit(eventCNumber).unpack();`
      ///
      /// These functions take a `psibase::EventNumber`, aka `uint64_t`, which uniquely identifies the event. These numbers were generated by [Service::emit].
      ///
      /// The functions return `psio::shared_view_ptr<std::tuple<event argument types>>`. You can get the tuple using `unpack()`, like above.
      ///
      /// There are restrictions on when events can be read; see the following for details:
      ///
      /// - [DbId::historyEvent]
      /// - [DbId::uiEvent]
      /// - [DbId::merkleEvent]
      EventReader<DerivedService> events() const
      {
         return EventReader<DerivedService>(getReceiver());
      }

     private:
      template <typename Service>
      friend void dispatch(AccountNumber receiver, AccountNumber sender);
   };  // Service
};     // namespace psibase

#define PSIBASE_REFLECT_EVENTS(SERVICE)       \
   using SERVICE##_Events = SERVICE ::Events; \
   PSIO_REFLECT(SERVICE##_Events)

#define PSIBASE_REFLECT_HISTORY_EVENTS(SERVICE, ...)          \
   using SERVICE##_EventsHistory = SERVICE ::Events::History; \
   PSIO_REFLECT(SERVICE##_EventsHistory, __VA_ARGS__)

#define PSIBASE_REFLECT_UI_EVENTS(SERVICE, ...)     \
   using SERVICE##_EventsUi = SERVICE ::Events::Ui; \
   PSIO_REFLECT(SERVICE##_EventsUi, __VA_ARGS__)

#define PSIBASE_REFLECT_MERKLE_EVENTS(SERVICE, ...)         \
   using SERVICE##_EventsMerkle = SERVICE ::Events::Merkle; \
   PSIO_REFLECT(SERVICE##_EventsMerkle, __VA_ARGS__)

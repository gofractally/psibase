#pragma once

#include <concepts>
#include <psibase/AccountNumber.hpp>
#include <psibase/Actor.hpp>
#include <psibase/Table.hpp>

namespace psibase
{
   template <typename T>
   concept DefinesContract =
       std::same_as<std::decay_t<decltype(T::contract)>, psibase::AccountNumber>;

   // A table to use if your contract needs to be initialized
   struct InitializedRecord
   {
      uint8_t key{0};  // Initialized if a record exists
   };
   PSIO_REFLECT(InitializedRecord, key);
   using InitTable_t = Table<InitializedRecord, &InitializedRecord::key>;

   /// Contracts should inherit from this
   ///
   /// Template arguments:
   /// - `DerivedContract`: the most-derived contract class that inherits from `Contract`
   ///
   /// #### Defining a contract
   ///
   /// To define a contract:
   /// - Make a struct or class which publicly inherits from `Contract`
   /// - Define or declare the set of methods
   /// - Reflect the methods using `PSIO_REFLECT`. Only reflected methods become actions; these are available for transactions and for other contracts to call using [call] or [Actor].
   ///
   /// Example:
   ///
   /// ```c++
   /// struct MyContract: psibase::Contract<MyContract>
   /// {
   ///    void        doSomething(std::string_view str);
   ///    std::string somethingElse(uint32_t x, psibase::AccountNumber y);
   /// };
   ///
   /// PSIO_REFLECT(MyContract,
   ///              method(doSomething, str),
   ///              method(somethingElse, x, y))
   /// ```
   ///
   /// #### Reserved action names
   ///
   /// psibase standard action names end with `Sys` or `_Sys` (case insensitive). You should avoid this suffix
   /// when defining your own actions if they're not implementing one of the
   /// [existing standards](../../standards/actions.html) documented in this book. If you don't avoid it, your
   /// contract may misbehave when future standards are adopted. e.g. don't create an action named `emphasys`.
   ///
   /// #### Calling other contracts
   ///
   /// [Actor] supports calling other contracts. [Contract::at] and [Contract::as] simplify obtaining an actor.
   ///
   /// To call another contract:
   ///
   /// ```c++
   /// auto result = at<OtherContractClass>(otherContractAccount).someMethod(args...);
   /// ```
   ///
   /// To call into this contract recursively:
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
   /// To define events for a contract, declare the event functions as below, then reflect them using the macros below. Skip any macro for event types you do not have.
   ///
   /// After you have defined your events, use [Contract::emit] to emit them and [Contract::events] to read them.
   ///
   /// TODO: Merkle events aren't implemented yet
   ///
   /// ```c++
   /// struct MyContract: psibase::Contract<MyContract> {
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
   /// PSIBASE_REFLECT_HISTORY_EVENTS(
   ///    MyContract,
   ///    method(myEvent, a, s),
   ///    method(anotherEvent, account))
   ///
   /// PSIBASE_REFLECT_UI_EVENTS(
   ///    MyContract,
   ///    method(updateDisplay))
   ///
   /// PSIBASE_REFLECT_MERKLE_EVENTS(
   ///    MyContract,
   ///    method(credit, from, to, amount))
   /// ```
   ///
   /// #### Recursion safety
   ///
   /// - By default, contracts support recursion. TODO: make it opt-in instead.
   /// - When a contract is called multiple times within a transaction, including recursively, each action gets a fresh `DerivedContract` instance. However, it runs in the same WASM memory space as the other executing actions for that contract. Global variables and static variables are shared.
   /// - Potential hazards to watch out for:
   ///   - If a call modifies member variables within a Contract instance, other calls aren't likely to see it.
   ///   - If a call modifies global or static variables, this will effect both the other currently-executing calls, and subsequent calls.
   ///   - If a call modifies the database, other currently-executing calls will see the change only if they read or re-read the database.
   ///   - When you call into any contract; assume it can call you back unless you opted out of recursion. TODO: make it possible to opt out of recursion.
   ///   - Calling other contracts while you are iterating through the database can be dangerous, since they can call back into you, causing you to change the database.
   ///
   /// The notes above use the following definition of "call":
   ///
   /// - Using actions in a transaction to enter the contract
   /// - Using [call] or [Actor] to enter or reenter the contract
   ///
   /// Calling contract methods directly (e.g. `this->doSomething()`) don't count in this definition.
   template <typename DerivedContract>
   class Contract
   {
     public:
      /// The account which authorized the currently-executing action
      AccountNumber getSender() const { return _sender; }

      /// The account which received the currently-executing action
      AccountNumber getReceiver() const { return _receiver; }

      /// Call a contract
      ///
      /// Template arguments:
      /// - `Other`: the receiver's class
      ///
      /// Returns an [Actor] for calling `receiver` using the current contract's authority.
      ///
      /// Example use:
      ///
      /// ```c++
      /// auto result = at<OtherContractClass>(otherContractAccount).someMethod(args...);
      /// ```
      template <typename Other = DerivedContract>
      Actor<Other> at(AccountNumber receiver)
      {
         return Actor<Other>(_receiver, receiver);
      }

      /// Call a contract
      ///
      /// Template arguments:
      /// - `Other`: the receiver's class
      ///
      /// Returns an [Actor] for calling `receiver` using the current contract's authority.
      /// This version sets receiver to `Other::contract`; this works if `Other` defined
      /// a const member named `contract` which identifies the account that contract is
      /// normally installed on.
      ///
      /// Example use:
      ///
      /// ```c++
      /// auto result = at<OtherContractClass>().someMethod(args...);
      /// ```
      template <DefinesContract Other = DerivedContract>
      Actor<Other> at()
      {
         return at<Other>(Other::contract);
      }

      /// Call a contract
      ///
      /// - If `u` is `0` (the default), then use this contract's authority ([getReceiver]).
      /// - If `u` is non-0, then use `u`'s authority. Non-priviledged contracts may only use their own authority.
      ///
      /// In either case, defaults to sending actions to this contract (recursion).
      ///
      /// See [Contract::at]; it covers the majority use case.
      ///
      /// Example use:
      ///
      /// ```c++
      /// auto result =
      ///   as(userAccount)
      ///   .at<OtherContractClass, otherContractAccount>()
      ///   .someMethod(args...);
      /// ```
      Actor<DerivedContract> as(AccountNumber u = AccountNumber())
      {
         if (u == AccountNumber())
            return {_sender, _receiver};
         return {u, _receiver};
      }

      /// Emit events
      ///
      /// The following examples use the example definitions in [Defining Events](#defining-events). After you have defined your events, you can use `emit` to emit them. Examples:
      ///
      /// - `auto eventANumber = emit().history().myEvent(a, s);`
      /// - `auto eventBNumber = emit().ui().updateDisplay();`
      /// - `auto eventCNumber = emit().merkle().credit(from, to, amount);`
      ///
      /// These functions return a `psibase::EventNumber`, aka `uint64_t`, which uniquely identifies the event. This number supports lookup; see [Contract::events].
      EventEmitter<DerivedContract> emit() const
      {
         return EventEmitter<DerivedContract>(_receiver);
      }

      /// Read events
      ///
      /// The following examples use the example definitions in [Defining Events](#defining-events). After you have defined your events, you can use `events` to read them. Examples:
      ///
      /// * `auto eventAArguments = events().history().myEvent(eventANumber).unpack();`
      /// * `auto eventBArguments = events().ui().updateDisplay(eventBNumber).unpack();`
      /// * `auto eventCArguments = events().merkle().credit(eventCNumber).unpack();`
      ///
      /// These functions take a `psibase::EventNumber`, aka `uint64_t`, which uniquely identifies the event. These numbers were generated by [Contract::emit].
      ///
      /// The functions return `psio::shared_view_ptr<std::tuple<event argument types>>`. You can get the tuple using `unpack()`, like above.
      ///
      /// There are restrictions on when events can be read; see the following for details:
      ///
      /// - [DbId::historyEvent]
      /// - [DbId::uiEvent]
      /// - [DbId::merkleEvent]
      EventReader<DerivedContract> events() const
      {
         return EventReader<DerivedContract>(_receiver);
      }

     private:
      template <typename Contract>
      friend void dispatch(AccountNumber receiver, AccountNumber sender);

      // called by dispatch
      void dispatchSetSenderReceiver(AccountNumber sender, AccountNumber receiver)
      {
         _sender   = sender;
         _receiver = receiver;
      }

      AccountNumber _sender;
      AccountNumber _receiver;
   };

};  // namespace psibase

#define PSIBASE_REFLECT_HISTORY_EVENTS(CONTRACT, ...)           \
   using CONTRACT##_EventsHistory = CONTRACT ::Events::History; \
   PSIO_REFLECT(CONTRACT##_EventsHistory, __VA_ARGS__)

#define PSIBASE_REFLECT_UI_EVENTS(CONTRACT, ...)      \
   using CONTRACT##_EventsUi = CONTRACT ::Events::Ui; \
   PSIO_REFLECT(CONTRACT##_EventsUi, __VA_ARGS__)

#define PSIBASE_REFLECT_MERKLE_EVENTS(CONTRACT, ...)          \
   using CONTRACT##_EventsMerkle = CONTRACT ::Events::Merkle; \
   PSIO_REFLECT(CONTRACT##_EventsMerkle, __VA_ARGS__)

#pragma once

#include <concepts>
#include <psibase/AccountNumber.hpp>
#include <psibase/Actor.hpp>

namespace psibase
{
   template <typename T>
   concept DefinesContract =
       std::same_as<std::decay_t<decltype(T::contract)>, psibase::AccountNumber>;

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
   /// struct MyContract : psibase::Contract<MyContract>
   /// {
   ///    void        doSomething(std::string_view str);
   ///    std::string another(uint32_t x, psibase::AccountNumber y);
   /// };
   ///
   /// PSIO_REFLECT(MyContract,
   ///              method(doSomething, str),
   ///              method(another, x, y))
   /// ```
   ///
   /// #### Multiple calls and recursion
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

      auto emit() const { return EventEmitter<DerivedContract>(_receiver); }
      auto events() const { return EventReader<DerivedContract>(_receiver); }

      /// Prepare to call another contract
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

      /// Prepare to call another contract
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

      /// Prepare to call another contract
      ///
      /// - If `u` is `0` (the default), then use this contract's authority ([getReceiver]).
      /// - If `u` is non-0, then use `u`'s authority. Non-priviledged contracts may only use their own authority.
      ///
      /// See [at]; it covers the majority use cases.
      Actor<DerivedContract> as(AccountNumber u = AccountNumber())
      {
         if (u == AccountNumber())
            return {_sender, _receiver};
         return {u, _receiver};
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

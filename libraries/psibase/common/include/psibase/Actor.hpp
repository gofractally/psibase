#pragma once
#include <psibase/block.hpp>
#include <psibase/check.hpp>
#include <psibase/db.hpp>
#include <psibase/nativeFunctions.hpp>
#include <psio/fracpack.hpp>

namespace psibase
{
   /**
    *  When an action is called it returns
    *
    *  psibase::Action {
    *    .sender,
    *    .contract,
    *    .rawData = actionnum, packed_parameters
    *  }
    *
    *  This is useful for tester
    */
   struct action_builder_proxy
   {
      action_builder_proxy(AccountNumber s, AccountNumber r) : sender(s), receiver(r) {}

      AccountNumber sender;
      AccountNumber receiver;

      // TODO: remove idx (unused)
      template <uint32_t idx, uint64_t Name, auto MemberPtr, typename... Args>
      auto call(Args&&... args) const
      {
         using member_class = decltype(psio::class_of_member(MemberPtr));
         using param_tuple  = decltype(psio::tuple_remove_view(psio::args_as_tuple(MemberPtr)));

         static_assert(std::tuple_size<param_tuple>() <= sizeof...(Args),
                       "too few arguments passed to method");
         static_assert(std::tuple_size<param_tuple>() == sizeof...(Args),
                       "too many arguments passed to method");

         return psibase::Action{sender, receiver, MethodNumber(Name),
                                psio::convert_to_frac(param_tuple(std::forward<Args>(args)...))};
      }
   };

   //#ifdef __wasm__
   template <typename T>
   psio::shared_view_ptr<T> fraccall(const Action& a)
   {
      auto packed_action = psio::convert_to_frac(a);  /// TODO: avoid double copy of action data
      auto result_size   = raw::call(packed_action.data(), packed_action.size());
      if constexpr (not std::is_same_v<void, T>)
      {
         psio::shared_view_ptr<T> result(psio::size_tag{result_size});
         raw::getResult(result.data(), result_size, 0);
         check(result.validate(), "value returned was not serialized as expected");
         return result;
      }
      return {};
   }

   /**
 *  This will dispatch a sync call and grab the return
 */
   struct sync_call_proxy
   {
      sync_call_proxy(AccountNumber s, AccountNumber r) : sender(s), receiver(r) {}

      AccountNumber sender;
      AccountNumber receiver;

      // TODO: remove idx (unused)
      template <uint32_t idx, uint64_t Name, auto MemberPtr, typename... Args>
      auto call(Args&&... args) const
      {
         auto act = action_builder_proxy(sender, receiver)
                        .call<idx, Name, MemberPtr, Args...>(std::forward<Args>(args)...);
         using result_type = decltype(psio::result_of(MemberPtr));
         if constexpr (not std::is_same_v<void, result_type>)
         {
            return psibase::fraccall<result_type>(act);
         }
         else
         {
            psibase::fraccall<void>(act);
         }
      }
   };

   /**
    *  This will generate an event and return the sequence number
    */
   struct EventEmitterProxy
   {
      EventEmitterProxy(AccountNumber s, DbId elog = psibase::DbId::historyEvent)
          : sender(s), event_log(elog)
      {
      }

      AccountNumber sender;
      DbId          event_log;

      // TODO: remove idx (unused)
      template <uint32_t idx, uint64_t Name, auto MemberPtr, typename... Args>
      EventNumber call(Args&&... args) const
      {
         using param_tuple = decltype(psio::tuple_remove_view(psio::args_as_tuple(MemberPtr)));
         static_assert(std::tuple_size<param_tuple>() == sizeof...(Args),
                       "insufficient arguments passed to method");

         return psibase::kvPutSequential(event_log, sender, Name,
                                         param_tuple(std::forward<Args>(args)...));
      }
   };

   struct EventReaderProxy
   {
      EventReaderProxy(AccountNumber s, DbId elog = psibase::DbId::historyEvent)
          : sender(s), event_log(elog)
      {
      }

      AccountNumber sender;
      DbId          event_log;

      // TODO: remove idx (unused)
      template <uint32_t idx, uint64_t Name, auto MemberPtr>
      auto call(EventNumber n) const
      {
         auto size         = raw::kvGetSequential(event_log, n);
         using param_tuple = decltype(psio::tuple_remove_view(psio::args_as_tuple(MemberPtr)));
         struct EventHeader
         {
            AccountNumber sender;
            MethodNumber  event_type;
         };

         EventHeader header;
         raw::getResult(&header, sizeof(header));
         psibase::check(header.event_type == Name, "unexpected event type");
         psibase::check(header.sender == sender, "unexpected event sender");

         std::vector<char> tmp(size);
         raw::getResult(tmp.data(), tmp.size(), 0);

         psio::shared_view_ptr<param_tuple> ptr(psio::size_tag{size - 8});
         memcpy(ptr.data(), tmp.data() + 8, ptr.size());
         return ptr;
      }
   };

   /// Emits events
   ///
   /// Template arguments:
   /// - `T`: the contract class which defines the events (e.g. `MyContract`), or
   /// - `T`: the inner-most struct within the contract class which defines the events (e.g. `MyContract::Events::History`)
   ///
   /// #### Emit methods
   ///
   /// `EventEmitter` uses reflection to get the set of events on `T`. It adds methods to
   /// itself with the same names and arguments.
   ///
   /// For example, assume `SomeContract` has the set of events in [Defining Events](#defining-events). `EventEmitter<MyContract> e` will support the following:
   ///
   /// * `e.history().myEvent(a, s);`
   /// * `e.ui().updateDisplay();`
   /// * `e.merkle().credit(from, to, amount);`
   ///
   /// These functions return a `psibase::EventNumber`, aka `uint64_t`, which uniquely identifies the event. This number supports lookup; see [Contract::events].
   ///
   /// TODO: Merkle events aren't implemented yet
   ///
   /// @hidebases
   template <typename T = void>
   struct EventEmitter : public psio::reflect<T>::template proxy<EventEmitterProxy>
   {
      using Base = typename psio::reflect<T>::template proxy<EventEmitterProxy>;

      /// Constructor
      ///
      /// Initialize the emitter with:
      ///
      /// - `sender`: the account emitting the events
      /// - `elog`: the event log to emit to
      ///
      /// You probably don't need this constructor; use [Contract::emit] instead.
      EventEmitter(AccountNumber sender, DbId elog = psibase::DbId::historyEvent)
          : Base{sender, elog}
      {
      }

      /// Emit Ui events
      ///
      /// See [Emit Methods](#emit-methods)
      auto ui() const
      {
         return EventEmitter<typename T::Events::Ui>(this->psio_get_proxy().sender,
                                                     psibase::DbId::uiEvent);
      }

      /// Emit History events
      ///
      /// See [Emit Methods](#emit-methods)
      auto history() const
      {
         return EventEmitter<typename T::Events::History>(this->psio_get_proxy().sender,
                                                          psibase::DbId::historyEvent);
      }

      /// Emit Merkle events
      ///
      /// See [Emit Methods](#emit-methods)
      auto merkle() const
      {
         return EventEmitter<typename T::Events::Merkle>(this->psio_get_proxy().sender,
                                                         psibase::DbId::merkleEvent);
      }

      /// Emit events from sender
      ///
      /// This returns a new `EventEmitter` object instead of modifying this.
      ///
      /// You probably don't need this; use [Contract::emit] instead.
      auto at(AccountNumber sender) const
      {
         return EventEmitter(sender, this->psio_get_proxy().event_log);
      }

      /// Return this
      auto* operator->() const { return this; }

      /// Return *this
      auto& operator*() const { return *this; }
   };

   /// Reads events
   ///
   /// Template arguments:
   /// - `T`: the contract class which defines the events (e.g. `MyContract`), or
   /// - `T`: the inner-most struct within the contract class which defines the events (e.g. `MyContract::Events::History`)
   ///
   /// #### Reader methods
   ///
   /// `EventReader` uses reflection to get the set of events on `T`. It adds methods to
   /// itself with the same names and arguments.
   ///
   /// For example, assume `SomeContract` has the set of events in [Defining Events](#defining-events). `EventReader<MyContract> e` will support the following:
   ///
   /// * `auto eventAArguments = e.history().myEvent(eventANumber).unpack();`
   /// * `auto eventBArguments = e.ui().updateDisplay(eventBNumber).unpack();`
   /// * `auto eventCArguments = e.merkle().credit(eventCNumber).unpack();`
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
   ///
   /// TODO: Merkle events aren't implemented yet
   ///
   /// @hidebases
   template <typename T = void>
   struct EventReader : public psio::reflect<T>::template proxy<EventReaderProxy>
   {
      using Base = typename psio::reflect<T>::template proxy<EventReaderProxy>;

      /// Constructor
      ///
      /// Initialize the reader with:
      ///
      /// - `sender`: the account which emitted the events
      /// - `elog`: the event log to read from
      ///
      /// You probably don't need this constructor; use [Contract::events] instead.
      EventReader(AccountNumber sender, DbId elog = psibase::DbId::historyEvent)
          : Base{sender, elog}
      {
      }

      /// Read Ui events
      ///
      /// See [Reader Methods](#reader-methods)
      auto ui() const
      {
         return EventReader<typename T::Events::Ui>(this->psio_get_proxy().sender,
                                                    psibase::DbId::uiEvent);
      }

      /// Read History events
      ///
      /// See [Reader Methods](#reader-methods)
      auto history() const
      {
         return EventReader<typename T::Events::History>(this->psio_get_proxy().sender,
                                                         psibase::DbId::historyEvent);
      }

      /// Read Merkle events
      ///
      /// See [Reader Methods](#reader-methods)
      auto merkle() const
      {
         return EventReader<typename T::Events::Merkle>(this->psio_get_proxy().sender,
                                                        psibase::DbId::merkleEvent);
      }

      /// Read events from sender
      ///
      /// This returns a new `EventReader` object instead of modifying this.
      ///
      /// You probably don't need this; use [Contract::events] instead.
      auto at(AccountNumber sender)
      {
         return EventReader(sender, this->psio_get_proxy().event_log);
      }

      /// Return this
      auto* operator->() const { return this; }

      /// Return *this
      auto& operator*() const { return *this; }
   };

#ifndef GENERATING_DOCUMENTATION
   template <typename T = void>
   struct Actor : public psio::reflect<T>::template proxy<sync_call_proxy>
   {
      using Base = typename psio::reflect<T>::template proxy<sync_call_proxy>;
      using Base::Base;

      auto as(AccountNumber other) const { return Actor(other, Base::receiver); }

      template <typename Other, uint64_t OtherReceiver>
      auto at() const
      {
         return Actor<Other>(Base::sender, AccountNumber(OtherReceiver));
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };

   template <>
   struct Actor<void>
   {
      AccountNumber sender;
      AccountNumber receiver;

      Actor(AccountNumber s = AccountNumber(), AccountNumber r = AccountNumber())
          : sender(s), receiver(r)
      {
      }

      auto as(AccountNumber other) const { return Actor(other, receiver); }

      template <typename Other, uint64_t OtherReceiver>
      auto at() const
      {
         return Actor<Other>(sender, AccountNumber(OtherReceiver));
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };
#endif  // !GENERATING_DOCUMENTATION

#ifdef GENERATING_DOCUMENTATION
   /// Calls other contracts
   ///
   /// Template arguments:
   /// - `T`: the contract class for the receiver
   ///
   /// #### Actor methods
   ///
   /// `Actor` uses reflection to get the set of methods on `T`. It adds methods to
   /// itself with the same names, arguments, and return types to simplify calling.
   ///
   /// For example, if `SomeContract` has this set of methods:
   ///
   /// ```c++
   /// struct SomeContract : psibase::Contract<SomeContract>
   /// {
   ///    void        doSomething(std::string_view str);
   ///    std::string doAnother(uint32_t x, psibase::AccountNumber y);
   /// };
   /// PSIO_REFLECT(SomeContract,
   ///              method(doSomething, str),
   ///              method(doAnother, x, y))
   /// ```
   ///
   /// Then `Actor<SomeContract>` will have the same methods. Actor's methods:
   /// - Pack their arguments, along with `sender` and `receiver` into [Action]
   /// - Use [call] to synchronously call `receiver` with the action data
   /// - Unpack the return value from the synchonous call
   /// - Return it
   template <typename T = void>
   struct Actor
   {
      // **** This isn't the real version; it's just the version the doc generator sees ****
      //
      // Differences:
      // - doesn't inherit from proxy; showing that would complicate the documentation
      // - reproduces the interface that proxy provides
      // - explicit types on function return values
      // - no implementations on functions

      AccountNumber sender;    ///< Use this authority
      AccountNumber receiver;  ///< Send actions to this account

      /// Constructor
      ///
      /// This actor will send actions to `receiver` using `sender` authority.
      ///
      /// You probably don't need this constructor; use [Contract::at] or [Contract::as].
      ///
      /// Non-priviledged contracts may only use their own authority.
      Actor(AccountNumber sender, AccountNumber receiver);

      /// Use `other` authority
      ///
      /// This returns a new `Actor` object instead of modifying this.
      ///
      /// Non-priviledged contracts may only use their own authority.
      Actor<T> as(AccountNumber other) const;

      /// Select a contract to send actions to
      ///
      /// Template arguments:
      /// - `Other`: the contract's class
      /// - `OtherReceiver`: the account the contract runs on
      ///
      /// This returns a new `Actor` object instead of modifying this.
      template <typename Other, uint64_t OtherReceiver>
      Actor<Other> at() const;

      /// Return this
      Actor<T>* operator->() const;

      /// Return *this
      Actor<T>& operator*() const;
   };
#endif

   /**
 *  Builds actions to add to transactions
 */

   template <typename T>
   struct transactor : public psio::reflect<T>::template proxy<action_builder_proxy>
   {
      using base = typename psio::reflect<T>::template proxy<action_builder_proxy>;
      using base::base;

      auto as(AccountNumber other) const
      {
         return transactor(other, base::psio_get_proxy().receiver);
      }

      template <typename Other, uint64_t OtherReceiver>
      auto at() const
      {
         return transactor<Other>(base::psio_get_proxy().sender, OtherReceiver);
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };

}  // namespace psibase

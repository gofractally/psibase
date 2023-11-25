#pragma once
#include <psibase/block.hpp>
#include <psibase/check.hpp>
#include <psibase/db.hpp>
#include <psibase/RawNativeFunctions.hpp>
#include <psibase/serviceState.hpp>
#include <psio/fracpack.hpp>

namespace psibase
{
   template <typename T>
   concept DefinesService =
       std::same_as<std::decay_t<decltype(T::service)>, psibase::AccountNumber>;

   /**
    *  When an action is called it returns
    *
    *  psibase::Action {
    *    .sender,
    *    .service,
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

   template <typename T>
   auto fraccall(const Action& a)
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

   struct sync_call_unpack_proxy
   {
      sync_call_unpack_proxy(AccountNumber s, AccountNumber r) : sender(s), receiver(r) {}

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
            return psibase::fraccall<result_type>(act).unpack();
         else
            psibase::fraccall<void>(act);
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

         return psibase::putSequential(event_log, sender, Name,
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
         using param_tuple = decltype(psio::tuple_remove_view(psio::args_as_tuple(MemberPtr)));
         AccountNumber service;
         MethodNumber  type;
         MethodNumber  expected_type{Name};
         auto result = psibase::getSequential<param_tuple>(event_log, n, &sender, &expected_type,
                                                           &service, &type);
         if (!result)
         {
            psibase::check(type == MethodNumber{Name}, "unexpected event type");
            psibase::check(service == sender, "unexpected event sender");
            psibase::check(false, "event not found");
         }
         return std::move(*result);
      }
   };

   /// Emits events
   ///
   /// Template arguments:
   /// - `T`: the service class which defines the events (e.g. `MyService`), or
   /// - `T`: the inner-most struct within the service class which defines the events (e.g. `MyService::Events::History`)
   ///
   /// #### Emit methods
   ///
   /// `EventEmitter` uses reflection to get the set of events on `T`. It adds methods to
   /// itself with the same names and arguments.
   ///
   /// For example, assume `SomeService` has the set of events in [Defining Events](#defining-events). `EventEmitter<MyService> e` will support the following:
   ///
   /// * `e.history().myEvent(a, s);`
   /// * `e.ui().updateDisplay();`
   /// * `e.merkle().credit(from, to, amount);`
   ///
   /// These functions return a `psibase::EventNumber`, aka `uint64_t`, which uniquely identifies the event. This number supports lookup; see [Service::events].
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
      /// - `elog`: the event log to emit to
      ///
      /// [Service::emit] is a shortcut to constructing this.
      EventEmitter(DbId elog = psibase::DbId::historyEvent) : Base{getReceiver(), elog} {}

      /// Emit Ui events
      ///
      /// See [Emit Methods](#emit-methods)
      auto ui() const { return EventEmitter<typename T::Events::Ui>(psibase::DbId::uiEvent); }

      /// Emit History events
      ///
      /// See [Emit Methods](#emit-methods)
      auto history() const
      {
         return EventEmitter<typename T::Events::History>(psibase::DbId::historyEvent);
      }

      /// Emit Merkle events
      ///
      /// See [Emit Methods](#emit-methods)
      auto merkle() const
      {
         return EventEmitter<typename T::Events::Merkle>(psibase::DbId::merkleEvent);
      }

      /// Emit events from sender
      ///
      /// This returns a new `EventEmitter` object instead of modifying this.
      ///
      /// You probably don't need this; use [Service::emit] instead.
      auto from(AccountNumber sender) const
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
   /// - `T`: the service class which defines the events (e.g. `MyService`), or
   /// - `T`: the inner-most struct within the service class which defines the events (e.g. `MyService::Events::History`)
   ///
   /// #### Reader methods
   ///
   /// `EventReader` uses reflection to get the set of events on `T`. It adds methods to
   /// itself with the same names and arguments.
   ///
   /// For example, assume `SomeService` has the set of events in [Defining Events](#defining-events). `EventReader<MyService> e` will support the following:
   ///
   /// * `auto eventAArguments = e.history().myEvent(eventANumber).unpack();`
   /// * `auto eventBArguments = e.ui().updateDisplay(eventBNumber).unpack();`
   /// * `auto eventCArguments = e.merkle().credit(eventCNumber).unpack();`
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
      /// - `elog`: the event log to read from
      ///
      /// [Service::events] is a shortcut for constructing this.
      EventReader(DbId elog = psibase::DbId::historyEvent) : Base{getReceiver(), elog} {}
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
      /// You probably don't need this; use [Service::events] instead.
      auto from(AccountNumber sender)
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
   struct Actor : public psio::reflect<T>::template proxy<sync_call_unpack_proxy>
   {
      using Base = typename psio::reflect<T>::template proxy<sync_call_unpack_proxy>;
      using Base::Base;

      auto from(AccountNumber other) const { return Actor(other, Base::receiver); }

      template <typename Other>
      auto to(uint64_t otherReceiver) const
      {
         return Actor<Other>(Base::sender, AccountNumber(otherReceiver));
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }

      auto view() const
      {
         return typename psio::reflect<T>::template proxy<sync_call_proxy>{
             Base::psio_get_proxy().sender, Base::psio_get_proxy().receiver};
      }
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

      auto from(AccountNumber other) const { return Actor(other, receiver); }

      template <typename Other>
      auto to(uint64_t otherReceiver) const
      {
         return Actor<Other>(sender, AccountNumber(otherReceiver));
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };
#endif  // !GENERATING_DOCUMENTATION

#ifdef GENERATING_DOCUMENTATION
   /// Calls other services
   ///
   /// Template arguments:
   /// - `T`: the service class for the receiver
   ///
   /// #### Actor methods
   ///
   /// `Actor` uses reflection to get the set of methods on `T`. It adds methods to
   /// itself with the same names, arguments, and return types to simplify calling.
   ///
   /// For example, if `SomeService` has this set of methods:
   ///
   /// ```c++
   /// struct SomeService : psibase::Service<SomeService>
   /// {
   ///    void        doSomething(std::string_view str);
   ///    std::string doAnother(uint32_t x, psibase::AccountNumber y);
   /// };
   /// PSIO_REFLECT(SomeService,
   ///              method(doSomething, str),
   ///              method(doAnother, x, y))
   /// ```
   ///
   /// Then `Actor<SomeService>` will have the same methods. Actor's methods:
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
      /// You probably don't need this constructor; use [psibase::to] or [psibase::from].
      ///
      /// Non-priviledged services may only use their own authority.
      Actor(AccountNumber sender, AccountNumber receiver);

      /// Use `other` authority
      ///
      /// This returns a new `Actor` object instead of modifying this.
      ///
      /// Non-priviledged services may only use their own authority.
      Actor<T> from(AccountNumber other) const;

      /// Select a service to send actions to
      ///
      /// Template arguments:
      /// - `Other`: the service's class
      ///
      /// Arguments
      /// - `otherReceiver`: the account the service runs on
      ///
      /// This returns a new `Actor` object instead of modifying this.
      template <typename Other>
      Actor<Other> to(uint64_t otherReceiver) const;

      /// Return this
      Actor<T>* operator->() const;

      /// Return *this
      Actor<T>& operator*() const;
   };
#endif

   struct EmptyService
   {
   };
   PSIO_REFLECT(EmptyService)

   /// Call a service
   ///
   /// Template arguments:
   /// - `Service`: the receiver's class
   ///
   /// Returns an [Actor] for calling `receiver` using the current service's authority.
   /// This version sets receiver to `Service::service`; this works if `Service` defined
   /// a const member named `service` which identifies the account that service is
   /// normally deployed on.
   ///
   /// [See the other overload](#psibaseto-1)
   ///
   /// Example use:
   ///
   /// ```c++
   /// auto result = to<OtherServiceClass>().someMethod(args...);
   /// ```
   template <DefinesService Service>
   Actor<Service> to()
   {
      return to<Service>(Service::service);
   }

   /// Call a service
   ///
   /// Template arguments:
   /// - `Service`: the receiver's class
   ///
   /// Returns an [Actor] for calling `receiver` using the current service's authority.
   ///
   /// [See the other overload](#psibaseto)
   ///
   /// Example use:
   ///
   /// ```c++
   /// auto result = to<OtherServiceClass>(otherServiceAccount).someMethod(args...);
   /// ```
   template <typename Service>
   Actor<Service> to(AccountNumber receiver)
   {
      return Actor<Service>(getReceiver(), receiver);
   }

   /// Call a service
   ///
   /// - If `u` is `0` (the default), then use this service's authority ([getReceiver]).
   /// - If `u` is non-0, then use `u`'s authority. Non-priviledged services may only use their own authority.
   ///
   /// [See psibase::to](#psibaseto); it covers the majority use case.
   ///
   /// Example use:
   ///
   /// ```c++
   /// auto result =
   ///   from(userAccount)
   ///   .to<OtherServiceClass>(otherServiceAccount)
   ///   .someMethod(args...);
   /// ```
   inline Actor<EmptyService> from(AccountNumber u = AccountNumber())
   {
      if (u == AccountNumber())
         return Actor<EmptyService>{getSender(), getReceiver()};
      return Actor<EmptyService>{u, getReceiver()};
   }

   /**
 *  Builds actions to add to transactions
 */

   template <typename T>
   struct transactor : public psio::reflect<T>::template proxy<action_builder_proxy>
   {
      using base = typename psio::reflect<T>::template proxy<action_builder_proxy>;
      using base::base;

      auto from(AccountNumber other) const
      {
         return transactor(other, base::psio_get_proxy().receiver);
      }

      template <typename Other>
      auto to(uint64_t otherReceiver) const
      {
         return transactor<Other>(base::psio_get_proxy().sender, otherReceiver);
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };

}  // namespace psibase

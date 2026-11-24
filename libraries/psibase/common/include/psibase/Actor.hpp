#pragma once
#include <psibase/api.hpp>
#include <psibase/block.hpp>
#include <psibase/check.hpp>
#include <psibase/db.hpp>
#include <psibase/export.hpp>
#include <psibase/serviceState.hpp>
#include <psio/reflect.hpp>
#include <psio/buffer.hpp>
#include <psio/mutable_view.hpp>
#include <psio/nested.hpp>
#include <psio/pssz.hpp>
#include <psio/pssz_view.hpp>
#include <psio/wire_type.hpp>

#include <cstddef>
#include <span>
#include <string>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>

namespace psibase
{
   template <typename T>
   concept DefinesService =
       std::same_as<std::decay_t<decltype(T::service)>, psibase::AccountNumber>;

   /// The number of a reflected method
   ///
   /// `I` and `MemberPtr` are what `psio::reflect<T>::proxy` hands to a call
   /// proxy: the index of the method in its class's reflection, and the
   /// pointer to it.
   template <std::size_t I, auto MemberPtr>
   inline constexpr MethodNumber methodNumber{psio::reflect<
       typename psio::method_traits<decltype(MemberPtr)>::class_type>::template method_name<I>};

   /// The class whose reflection lists the method `MemberPtr` points to
   template <auto MemberPtr>
   using MethodClass = typename psio::method_traits<decltype(MemberPtr)>::class_type;

   /// An [Action] whose arguments are not packed yet
   ///
   /// `rawData` is a source of the packed arguments
   /// (`psio::method_args_packed<T, I>(args...)`, `psio::packed(value)`)
   /// in place of the bytes. Packing a `LazyAction` writes the bytes of
   /// the [Action] it stands for, with the arguments written directly into
   /// them, and it is accepted wherever a packed [Action] is expected: as
   /// an argument of a call, so that a call inside a call is packed into
   /// one buffer.
   ///
   /// The arguments that were passed as lvalues are referred to, not
   /// copied: they must outlive the packing. It is a source for the PSSZ
   /// encoder only: the type of an action in a schema, and what has a JSON
   /// form, is [Action].
   template <typename Args>
   struct LazyAction
   {
      AccountNumber sender;   ///< Account sending the action
      AccountNumber service;  ///< Service to execute the action
      MethodNumber  method;   ///< Service method to execute
      Args          rawData;  ///< Source of the data for the method
      PSIO_REFLECT(LazyAction, sender, service, method, rawData)
   };
   template <typename Args>
   LazyAction(AccountNumber, AccountNumber, MethodNumber, Args) -> LazyAction<Args>;

   /// Builds an action without packing it: the result is a [LazyAction]
   /// that holds the arguments.
   struct LazyActionProxy
   {
      LazyActionProxy(AccountNumber s, AccountNumber r) : sender(s), receiver(r) {}

      AccountNumber sender;
      AccountNumber receiver;

      template <std::size_t I, auto MemberPtr, typename... Args>
      auto call(Args&&... args) const
      {
         return LazyAction{sender, receiver, methodNumber<I, MemberPtr>,
                           psio::method_args_packed<MethodClass<MemberPtr>, I>(
                               std::forward<Args>(args)...)};
      }
   };

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

      template <std::size_t I, auto MemberPtr, typename... Args>
      auto call(Args&&... args) const
      {
         return psibase::Action{sender, receiver, methodNumber<I, MemberPtr>,
                                psio::method_args_to_pssz<MethodClass<MemberPtr>, I>(
                                    std::forward<Args>(args)...)};
      }
   };

   template <typename T>
   struct ImportView
   {
      psio::shared_pssz<exportType<T>>         raw;
      psio::shared_pssz<std::vector<KvHandle>> handles;
      T unpack() const { return psibaseImport((T*)nullptr, raw.unpack(), handles.unpack()); }
   };

   namespace detail
   {
      [[noreturn]] inline void badResult(std::span<const char> packed_action)
      {
         psio::pssz_view<Action> action{packed_action};
         auto                    method_name = action.method().unpack().str();
         abortMessage(std::string("value returned from ") + method_name +
                      " was not serialized as expected");
      }
   }  // namespace detail

   /// Calls a service with a packed [Action] and returns its packed result
   ///
   /// `R` is the type of the result as it is packed. The bytes the callee
   /// returned are validated as an `R`. This is the call for an action that
   /// has no declaration here; a call of a reflected method goes through
   /// `callPacked<T, I>`, which reads the result as the method declares it.
   template <typename R>
   auto callPacked(std::span<const char> packed_action, CallFlags flags = CallFlags::none)
   {
      auto result_size = raw::call(packed_action.data(), packed_action.size(), flags);
      if constexpr (not std::is_same_v<void, R>)
      {
         auto bytes = getResult(result_size);
         if (!psio::validate_pssz<R>(bytes).ok())
            detail::badResult(packed_action);
         return psio::shared_pssz<R>::unchecked(std::move(bytes));
      }
   }

   /// Calls method `I` of the service `T` with a packed [Action] and returns
   /// its packed result
   ///
   /// The bytes the callee returned are validated as the result of the
   /// method: the type its `returns(...)` describes
   /// (`psio::validate_method_result`), so a bound or a string kind declared
   /// for the result is enforced here. What is returned holds those bytes
   /// and views them as that type: `psio::shared_pssz<R>` unless
   /// `returns(...)` narrows an offset width of `R`, in which case the view
   /// reads the result's own widths. A result that carries table handles
   /// (`psibaseExport`) is what it exports, with the handles beside it.
   template <typename T, std::size_t I>
   auto callPacked(std::span<const char> packed_action, CallFlags flags = CallFlags::none)
   {
      using R          = psio::method_result_t<T, I>;
      auto result_size = raw::call(packed_action.data(), packed_action.size(), flags);
      if constexpr (not std::is_void_v<R>)
      {
         auto bytes = getResult(result_size);
         if constexpr (hasExport<R>)
         {
            if (!psio::validate_pssz<exportType<R>>(bytes).ok())
               detail::badResult(packed_action);
            auto handles_size = raw::importHandles();
            // The host wrote the handles
            auto handles =
                psio::shared_pssz<std::vector<KvHandle>>::unchecked(getResult(handles_size));
            return ImportView<R>{psio::shared_pssz<exportType<R>>::unchecked(std::move(bytes)),
                                 std::move(handles)};
         }
         else
         {
            if (!psio::validate_method_result<T, I>(bytes).ok())
               detail::badResult(packed_action);
            using Format = typename psio::method_result_view<T, I>::format_type;
            return psio::buffer<R, Format, psio::storage::shared>::unchecked(std::move(bytes));
         }
      }
   }

   /// Calls method `I` of the service `T` with a packed [Action] and returns
   /// its result
   ///
   /// The bytes the callee returned are validated and decoded as the result
   /// of the method, with everything its `returns(...)` states
   /// (`psio::decode_method_result`).
   template <typename T, std::size_t I>
   psio::method_result_t<T, I> callUnpacked(std::span<const char> packed_action,
                                            CallFlags             flags = CallFlags::none)
   {
      using R = psio::method_result_t<T, I>;
      if constexpr (std::is_void_v<R>)
      {
         raw::call(packed_action.data(), packed_action.size(), flags);
      }
      else if constexpr (hasExport<R>)
      {
         return callPacked<T, I>(packed_action, flags).unpack();
      }
      else
      {
         auto bytes = getResult(raw::call(packed_action.data(), packed_action.size(), flags));
         R    result{};
         if (!psio::decode_method_result<T, I>(bytes, result).ok())
            detail::badResult(packed_action);
         return result;
      }
   }

   template <typename T>
   auto callPacked(const Action& a, CallFlags flags = CallFlags::none)
   {
      return callPacked<T>(psio::to_pssz(a), flags);
   }

   template <typename T>
   struct TypedAction
   {
      AccountNumber   sender;   ///< Account sending the action
      AccountNumber   service;  ///< Service to execute the action
      MethodNumber    method;   ///< Service method to execute
      psio::nested<T> rawData;  ///< Data for the method
      PSIO_REFLECT(TypedAction, sender, service, method, rawData)
   };

   /// Packs an action: the result is a packed [Action] whose `rawData`
   /// is typed as the method's argument tuple. The caller owns the bytes
   /// and may overwrite a fixed-size argument in place
   /// (`psio::as_mutable_view`) to send the action again.
   struct ActionViewProxy
   {
      ActionViewProxy(AccountNumber s, AccountNumber r) : sender(s), receiver(r) {}

      AccountNumber sender;
      AccountNumber receiver;

      template <std::size_t I, auto MemberPtr, typename... Args>
      auto call(Args&&... args) const
      {
         using Class = MethodClass<MemberPtr>;
         using Tuple = typename psio::reflect<Class>::template method_arg_tuple<I>;
         // One buffer: the arguments are written into the action.
         return psio::pssz_buffer<TypedAction<Tuple>>::unchecked(
             psio::to_pssz(LazyAction{sender, receiver, methodNumber<I, MemberPtr>,
                                      psio::method_args_packed<Class, I>(
                                          std::forward<Args>(args)...)}));
      }
   };

   /**
    *  This will dispatch a sync call and grab the return
    */
   struct sync_call_proxy
   {
      sync_call_proxy(AccountNumber s, AccountNumber r, CallFlags flags = CallFlags::none)
          : sender(s), receiver(r), flags(flags)
      {
      }

      AccountNumber sender;
      AccountNumber receiver;
      CallFlags     flags;

      template <std::size_t I, auto MemberPtr, typename... Args>
      auto call(Args&&... args) const
      {
         auto act = ActionViewProxy(sender, receiver)
                        .call<I, MemberPtr, Args...>(std::forward<Args>(args)...);
         return psibase::callPacked<MethodClass<MemberPtr>, I>(act.bytes(), flags);
      }
   };

   struct sync_call_unpack_proxy
   {
      sync_call_unpack_proxy(AccountNumber s, AccountNumber r, CallFlags flags = CallFlags::none)
          : sender(s), receiver(r), flags(flags)
      {
      }

      AccountNumber sender;
      AccountNumber receiver;
      CallFlags     flags;

      template <std::size_t I, auto MemberPtr, typename... Args>
      auto call(Args&&... args) const
      {
         auto act          = ActionViewProxy(sender, receiver)
                                 .call<I, MemberPtr, Args...>(std::forward<Args>(args)...);
         return psibase::callUnpacked<MethodClass<MemberPtr>, I>(act.bytes(), flags);
      }
   };

   /**
    *  This will generate an event and return the sequence number
    */
   struct EventEmitterProxy
   {
      EventEmitterProxy(AccountNumber s, EventDb elog = EventDb::historyEvent)
          : sender(s), event_log(elog)
      {
      }

      AccountNumber sender;
      EventDb       event_log;

      // The packed action that emits an event. The payload of an event is
      // the packed argument tuple of its method; payload, arguments and
      // action are written into one buffer.
      template <std::size_t I, auto MemberPtr, typename... Args>
      std::vector<char> pack(Args&&... args) const
      {
         return psio::to_pssz(LazyAction{
             sender, AccountNumber{"events"}, MethodNumber{"event"},
             psio::packed(std::tuple{event_log, methodNumber<I, MemberPtr>,
                                     psio::method_args_packed<MethodClass<MemberPtr>, I>(
                                         std::forward<Args>(args)...)})});
      }

      template <std::size_t I, auto MemberPtr, typename... Args>
      EventNumber call(Args&&... args) const
      {
         auto action = pack<I, MemberPtr, Args...>(std::forward<Args>(args)...);
         return callPacked<EventNumber>(std::span<const char>{action}).unpack();
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
      EventEmitter(EventDb elog = EventDb::historyEvent) : Base{getReceiver(), elog} {}

      /// Emit History events
      ///
      /// See [Emit Methods](#emit-methods)
      auto history() const
      {
         return EventEmitter<typename T::Events::History>(EventDb::historyEvent);
      }

      /// Emit Merkle events
      ///
      /// See [Emit Methods](#emit-methods)
      auto merkle() const { return EventEmitter<typename T::Events::Merkle>(EventDb::merkleEvent); }

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

#ifndef GENERATING_DOCUMENTATION
   template <typename T = void>
   struct Actor : public psio::reflect<T>::template proxy<sync_call_unpack_proxy>
   {
      using Base = typename psio::reflect<T>::template proxy<sync_call_unpack_proxy>;
      using Base::Base;

      auto from(AccountNumber other) const
      {
         return Actor(other, Base::psio_get_proxy().receiver, Base::psio_get_proxy().flags);
      }

      template <typename Other>
      auto to(AccountNumber otherReceiver = Other::service) const
      {
         return Actor<Other>(Base::psio_get_proxy().sender, AccountNumber(otherReceiver),
                             Base::psio_get_proxy().flags);
      }

      auto withFlags(CallFlags flags)
      {
         return Actor{Base::psio_get_proxy().sender, Base::psio_get_proxy().receiver, flags};
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }

      auto view() const
      {
         return typename psio::reflect<T>::template proxy<sync_call_proxy>{
             Base::psio_get_proxy().sender, Base::psio_get_proxy().receiver,
             Base::psio_get_proxy().flags};
      }
   };

   template <>
   struct Actor<void>
   {
      AccountNumber sender;
      AccountNumber receiver;
      CallFlags     flags;

      Actor(AccountNumber s     = AccountNumber(),
            AccountNumber r     = AccountNumber(),
            CallFlags     flags = CallFlags::none)
          : sender(s), receiver(r), flags(flags)
      {
      }

      auto from(AccountNumber other) const { return Actor(other, receiver, flags); }

      template <typename Other>
      auto to(uint64_t otherReceiver) const
      {
         return Actor<Other>(sender, AccountNumber(otherReceiver), flags);
      }

      auto withFlags(CallFlags flags) { return Actor{sender, receiver, flags}; }

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
   /// struct SomeService : psibase::Service
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
      Actor<Other> to(AccountNumber otherReceiver = Other::service) const;

      /// Set flags for calls
      Actor<T> withFlags(CallFlags flags);

      /// Return this
      Actor<T>* operator->() const;

      /// Return *this
      Actor<T>& operator*() const;
   };
#endif

   struct EmptyService
   {
      PSIO_REFLECT(EmptyService)
   };

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
      transactor() : base(T::service, T::service) {}

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

   template <typename T>
   struct ActionViewBuilder : public psio::reflect<T>::template proxy<ActionViewProxy>
   {
      using base = typename psio::reflect<T>::template proxy<ActionViewProxy>;
      using base::base;
   };

   /// Builds actions that are not packed yet
   ///
   /// Each method returns a [LazyAction]: the action with its arguments
   /// held, not packed. Pass it where an [Action] is an argument of a call
   /// (`to<XRun>().post(mode, lazy.someMethod(args...), ...)`) and the
   /// whole call is packed into one buffer.
   template <typename T>
   struct LazyActionBuilder : public psio::reflect<T>::template proxy<LazyActionProxy>
   {
      using base = typename psio::reflect<T>::template proxy<LazyActionProxy>;
      using base::base;
   };

}  // namespace psibase

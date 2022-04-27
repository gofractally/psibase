#pragma once
#include <psibase/block.hpp>
#include <psibase/check.hpp>
#include <psibase/db.hpp>
#include <psibase/intrinsic.hpp>
#include <psio/fracpack.hpp>

namespace psibase
{
   /**
 *  When an action is called it returns 
 *
 *  psibase::action {
 *    .sender,
 *    .contract,
 *    .raw_data = actionnum, packed_parameters
 *  }
 *
 *  This is useful for tester
 */
   struct action_builder_proxy
   {
      action_builder_proxy(AccountNumber s, AccountNumber r) : sender(s), receiver(r) {}

      AccountNumber sender;
      AccountNumber receiver;

      template <uint32_t idx, uint64_t Name, auto MemberPtr, typename... Args>
      auto call(Args&&... args) const
      {
         using member_class = decltype(psio::class_of_member(MemberPtr));
         using param_tuple  = decltype(psio::tuple_remove_view(psio::args_as_tuple(MemberPtr)));

         static_assert(std::tuple_size<param_tuple>() == sizeof...(Args),
                       "insufficient arguments passed to method");

         return psibase::Action{sender, receiver, MethodNumber(Name),
                                psio::convert_to_frac(param_tuple(std::forward<Args>(args)...))};
      }
   };

   //#ifdef __wasm__
   template <typename T>
   psio::shared_view_ptr<T> fraccall(const action& a)
   {
      auto packed_action = psio::convert_to_frac(a);  /// TODO: avoid double copy of action data
      auto result_size   = raw::call(packed_action.data(), packed_action.size());
      if constexpr (not std::is_same_v<void, T>)
      {
         psio::shared_view_ptr<T> result(psio::size_tag{result_size});
         raw::get_result(result.data(), result_size, 0);
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
      EventEmitterProxy(AccountNumber s, kv_map elog = psibase::kv_map::history_event)
          : sender(s), event_log(elog)
      {
      }

      AccountNumber sender;
      kv_map        event_log;

      template <uint32_t idx, uint64_t Name, auto MemberPtr, typename... Args>
      EventNumber call(Args&&... args) const
      {
         using param_tuple = decltype(psio::tuple_remove_view(psio::args_as_tuple(MemberPtr)));
         static_assert(std::tuple_size<param_tuple>() == sizeof...(Args),
                       "insufficient arguments passed to method");

         return psibase::kv_put_sequential(event_log, sender, Name,
                                           param_tuple(std::forward<Args>(args)...));
      }
   };

   struct EventReaderProxy
   {
      EventReaderProxy(AccountNumber s, kv_map elog = psibase::kv_map::history_event)
          : sender(s), event_log(elog)
      {
      }

      AccountNumber sender;
      kv_map        event_log;

      template <uint32_t idx, uint64_t Name, auto MemberPtr>
      auto call(EventNumber n) const
      {
         auto size         = raw::kv_get_sequential(event_log, n);
         using param_tuple = decltype(psio::tuple_remove_view(psio::args_as_tuple(MemberPtr)));
         struct EventHeader
         {
            AccountNumber sender;
            MethodNumber  event_type;
         };

         EventHeader header;
         raw::get_result(&header, sizeof(header));
         psibase::check(header.event_type == Name, "unexpected event type");
         psibase::check(header.sender == sender, "unexpected event sender");

         std::vector<char> tmp(size);
         raw::get_result(tmp.data(), tmp.size(), 0);

         psio::shared_view_ptr<param_tuple> ptr(psio::size_tag{size - 8});
         memcpy(ptr.data(), tmp.data() + 8, ptr.size());
         return ptr;
      }
   };

   template <typename T = void>
   struct EventEmitter : public psio::reflect<T>::template proxy<EventEmitterProxy>
   {
      using base = typename psio::reflect<T>::template proxy<EventEmitterProxy>;
      using base::base;

      auto ui() const
      {
         return EventEmitter<typename T::Events::Ui>(this->psio_get_proxy().sender,
                                                     psibase::kv_map::ui_event);
      }
      auto history() const
      {
         return EventEmitter<typename T::Events::History>(this->psio_get_proxy().sender,
                                                          psibase::kv_map::history_event);
      }
      auto merkle() const
      {
         return EventEmitter<typename T::Events::Merkle>(this->psio_get_proxy().sender,
                                                         psibase::kv_map::merkle_event);
      }
      auto at(AccountNumber n) { return EventEmitter(n, this->psio_get_proxy().event_log); }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };

   template <typename T = void>
   struct EventReader : public psio::reflect<T>::template proxy<EventReaderProxy>
   {
      using base = typename psio::reflect<T>::template proxy<EventReaderProxy>;
      using base::base;

      auto ui() const
      {
         return EventReader<typename T::Events::Ui>(this->psio_get_proxy().sender,
                                                    psibase::kv_map::ui_event);
      }
      auto history() const
      {
         return EventReader<typename T::Events::History>(this->psio_get_proxy().sender,
                                                         psibase::kv_map::history_event);
      }
      auto merkle() const
      {
         return EventReader<typename T::Events::Merkle>(this->psio_get_proxy().sender,
                                                        psibase::kv_map::merkle_event);
      }
      auto at(AccountNumber n) { return EventReader(n, this->psio_get_proxy().event_log); }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };

   /**
 * Makes calls to other contracts and gets the results
 */
   template <typename T = void>
   struct actor : public psio::reflect<T>::template proxy<sync_call_proxy>
   {
      using base = typename psio::reflect<T>::template proxy<sync_call_proxy>;
      using base::base;

      auto as(AccountNumber other) const { return actor(other, base::receiver); }

      template <typename Other, uint64_t OtherReceiver>
      auto at() const
      {
         return actor<Other>(base::sender, AccountNumber(OtherReceiver));
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };

   template <>
   struct actor<void>
   {
      AccountNumber sender;
      AccountNumber receiver;

      actor(AccountNumber s = AccountNumber(), AccountNumber r = AccountNumber())
          : sender(s), receiver(r)
      {
      }

      auto as(AccountNumber other) const { return actor(other, receiver); }

      template <typename Other, uint64_t OtherReceiver>
      auto at() const
      {
         return actor<Other>(sender, AccountNumber(OtherReceiver));
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };
   //#endif  // __wasm__

   /**
 *  Builds actions to add to transactions
 */

   template <typename T>
   struct transactor : public psio::reflect<T>::template proxy<action_builder_proxy>
   {
      using base = typename psio::reflect<T>::template proxy<action_builder_proxy>;
      using base::base;

      auto as(AccountNumber other) const { return transactor(other, base::receiver); }

      template <typename Other, uint64_t OtherReceiver>
      auto at() const
      {
         return transactor<Other>(base::sender, OtherReceiver);
      }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };

}  // namespace psibase

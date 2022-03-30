#pragma once
#include <psibase/block.hpp>
#include <psibase/intrinsic.hpp>
#include <psio/fracpack.hpp>

namespace psibase
{
   /** all contracts should derive from psibase::contract */
   class contract
   {
     public:
      account_num get_sender() const { return _sender; }
      account_num get_receiver() const { return _receiver; }

     private:
      template <typename Contract>
      friend void dispatch(account_num receiver, account_num sender);

      /* called by dispatch */
      void dispatch_set_sender_receiver(account_num sender, account_num receiver)
      {
         _sender   = sender;
         _receiver = receiver;
      }
      account_num _sender;
      account_num _receiver;
   };

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
      action_builder_proxy( AccountNumber s,  AccountNumber r) : sender(s), receiver(r) {}

      AccountNumber sender;
      AccountNumber receiver;

      template <uint32_t idx, uint64_t Name, auto MemberPtr, typename... Args>
      auto call(Args&&... args) const
      {
         using member_class = decltype(psio::class_of_member(MemberPtr));
         using param_tuple  = decltype(psio::tuple_remove_view(psio::args_as_tuple(MemberPtr)));

         param_tuple tup(std::forward<Args>(args)...);

         struct FRACPACK raw_variant_view
         {
            uint8_t  action_idx = idx;
            uint32_t size;
            char     data[];
         };

         auto param_tuple_size = psio::fracpack_size(tup);

         static_assert(std::tuple_size<param_tuple>() == sizeof...(Args),
                       "insufficient arguments passed to method");

         //  auto data = arg_var(std::in_place_index_t<idx>(),
         //                      param_tuple(std::forward<Args>(args)...));

         psibase::Action act{sender, receiver, Name};
         act.raw_data.resize(5 + param_tuple_size);
         auto rvv        = reinterpret_cast<raw_variant_view*>(act.raw_data.data());
         rvv->action_idx = idx;
         rvv->size       = param_tuple_size;

         psio::fast_buf_stream stream(rvv->data, param_tuple_size);
         psio::fracpack(tup, stream);

         return act;
      }
   };

   template <typename T>
   psio::shared_view_ptr<T> fraccall(const action& a)
   {
      auto packed_action = psio::convert_to_frac(a);  /// TODO: avoid double copy of action data
      auto result_size   = raw::call(packed_action.data(), packed_action.size());
      if constexpr (not std::is_same_v<void, T>)
      {
         psio::shared_view_ptr<T> result(psio::size_tag{result_size});
         raw::get_result(result.data(), result_size);
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
      sync_call_proxy( AccountNumber s,  AccountNumber r) : sender(s), receiver(r) {}

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
 * Makes calls to other contracts and gets the results
 */
   template <typename T=void>
   struct actor : public psio::reflect<T>::template proxy<sync_call_proxy>
   {
      using base = typename psio::reflect<T>::template proxy<sync_call_proxy>;
      using base::base;

      auto su( AccountNumber other )const { return actor( other, receiver ); }

      template<typename Other, AccountNumber OtherReciever = Other::receiver>
      auto at()const { return actor<Other>( sender, OtherReceiver); }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };

   template <>
   struct actor<void> 
   {
      AccountNumber sender;
      AccountNumber receiver;

      actor( AccountNumber s = AccountNumber(), AccountNumber r = AccountNumber() ):sender(s),receiver(r){}

      auto su( AccountNumber other )const { return actor( other, receiver ); }

      template<typename Other, AccountNumber OtherReciever = Other::contract>
      auto at()const { return actor<Other>( sender, OtherReceiver); }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };



   /**
 *  Builds actions to add to transactions
 */
   template <typename T>
   struct transactor : public psio::reflect<T>::template proxy<action_builder_proxy>
   {
      using base = typename psio::reflect<T>::template proxy<action_builder_proxy>;
      using base::base;

      auto su( AccountNumber other )const { return transactor( other, receiver ); }

      template<typename Other, AccountNumber OtherReciever = Other::receiver>
      auto at()const { return transactor<Other>( sender, OtherReceiver); }

      auto* operator->() const { return this; }
      auto& operator*() const { return *this; }
   };

}  // namespace psibase

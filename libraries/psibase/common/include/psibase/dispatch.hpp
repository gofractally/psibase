#pragma once
#include <psibase/AccountNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/nativeFunctions.hpp>
#include <psio/fracpack.hpp>

namespace psibase
{
   template <typename R, typename T, typename MemberPtr, typename... Args>
   void callMethod(T& service, MemberPtr method, Args&&... args)
   {
      psio::shared_view_ptr<R> p((service.*method)(std::forward<decltype(args)>(args)...));
      raw::setRetval(p.data(), p.size());
   }

   template <typename F, typename T, std::size_t... I>
   decltype(auto) tuple_call(F&& f, T&& t, std::index_sequence<I...>)
   {
      return f(get<I>(std::forward<T>(t))...);
   }

   template <typename F, typename T>
   decltype(auto) tuple_call(F&& f, T&& t)
   {
      return tuple_call(std::forward<F>(f), std::forward<T>(t),
                        std::make_index_sequence<std::tuple_size_v<std::remove_cvref_t<T>>>());
   }

   /**
    *  This method is called when a service receives a call and will
    *  and will call the proper method on Contact assuming Service has
    *  used the PSIO_REFLECT macro.
    */
   template <typename Service>
   void dispatch(AccountNumber sender, AccountNumber receiver)
   {
      auto act           = getCurrentActionView();
      auto prevSender    = internal::sender;
      internal::sender   = sender;
      internal::receiver = receiver;

      auto makeService = [&]()
      {
         if constexpr (std::is_constructible<Service, psio::shared_view_ptr<psibase::Action>>{})
         {
            return Service{act};
         }
         else
         {
            return Service{};
         }
      };
      auto service{makeService()};

      bool called = psio::reflect<Service>::get_by_name(
          act->method().value(),
          [&](auto meta, auto member)
          {
             auto member_func  = member(&service);
             using result_type = decltype(psio::result_of(member_func));
             using param_tuple =
                 decltype(psio::tuple_remove_view(psio::args_as_tuple(member_func)));

             auto param_data = std::span{act->rawData().data(), act->rawData().size()};
             psibase::check(psio::fracpack_validate<param_tuple>(param_data),
                            "invalid argument encoding for " + act->method().unpack().str());

             psio::view<const param_tuple> param_view(psio::prevalidated{param_data});

             tuple_call(
                 [&](auto... args)
                 {
                    if constexpr (std::is_same_v<void, result_type>)
                    {
                       (service.*member_func)(std::forward<decltype(args)>(args)...);
                    }
                    else
                    {
                       callMethod<result_type, Service, decltype(member_func), decltype(args)...>(
                           service, member_func, std::forward<decltype(args)>(args)...);
                    }
                 },
                 param_view);
          });  // reflect::get
      if (!called)
         abortMessage("unknown service action: " + act->method().unpack().str());
      internal::sender = prevSender;
      // psio::member_proxy
   }  // dispatch

}  // namespace psibase

// TODO: prevent recursion, but allow opt-in
#define PSIBASE_DISPATCH(SERVICE)                                                         \
   extern "C" void called(psibase::AccountNumber receiver, psibase::AccountNumber sender) \
   {                                                                                      \
      psibase::dispatch<SERVICE>(sender, receiver);                                       \
   }                                                                                      \
   extern "C" void __wasm_call_ctors();                                                   \
   extern "C" void start(psibase::AccountNumber thisService)                              \
   {                                                                                      \
      __wasm_call_ctors();                                                                \
   }
\

#pragma once
#include <psibase/AccountNumber.hpp>
#include <psibase/RawNativeFunctions.hpp>
#include <psibase/Service.hpp>
#include <psio/fracpack.hpp>

namespace psibase
{

   template <typename T>
   std::span<const char> find_view_span(psio::view<T> v)
   {
      const char*   start       = psio::get_view_data(v);
      bool          has_unknown = false;
      bool          known_end;
      std::uint32_t pos = 0;
      if (!psio::is_packable<std::remove_cv_t<T>>::template unpack<false, true>(
              nullptr, has_unknown, known_end, start, pos, 0xffffffffu))
      {
         static_assert(!psio::is_std_optional_v<std::remove_cv_t<T>>,
                       "Optional members are not stored in contiguous memory");
         assert(!"View must be valid");
         __builtin_unreachable();
      }
      if (known_end)
         return {start, pos};
      else
         return {};
   }

   template <typename T>
   constexpr bool is_view_v = false;
   template <typename T>
   constexpr bool is_view_v<psio::view<T>> = true;

   template <typename R, typename T, typename MemberPtr, typename... Args>
   void callMethod(T& service, MemberPtr method, Args&&... args)
   {
      if constexpr (is_view_v<R>)
      {
         R    v((service.*method)(std::forward<decltype(args)>(args)...));
         auto s = find_view_span(v);
         check(s.data() != nullptr, "Cannot handle extensions in returned view");
         raw::setRetval(s.data(), s.size());
      }
      else
      {
         psio::shared_view_ptr<R> p((service.*method)(std::forward<decltype(args)>(args)...));
         raw::setRetval(p.data(), p.size());
      }
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

   template <typename T>
   struct make_action_param_tuple;

   template <typename R, typename C, typename... A>
   struct make_action_param_tuple<R (C::*)(A...)>
   {
      using type = std::tuple<typename psio::remove_view_t<typename std::remove_cvref_t<A>>...>;
   };

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

      bool called = psio::get_member_function<Service>(
          act->method().value(),
          [&](auto member, auto /*names*/)
          {
             using result_type = decltype(psio::result_of(member));
             using param_tuple = typename make_action_param_tuple<decltype(member)>::type;

             auto param_data = std::span<const char>{act->rawData().data(), act->rawData().size()};
             psibase::check(psio::fracpack_validate<param_tuple>(param_data),
                            "invalid argument encoding for " + act->method().unpack().str());

             psio::view<const param_tuple> param_view(psio::prevalidated{param_data});

             tuple_call(
                 [&](auto... args)
                 {
                    if constexpr (std::is_same_v<void, result_type>)
                    {
                       (service.*member)(std::forward<decltype(args)>(args)...);
                    }
                    else
                    {
                       callMethod<result_type, Service, decltype(member), decltype(args)...>(
                           service, member, std::forward<decltype(args)>(args)...);
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

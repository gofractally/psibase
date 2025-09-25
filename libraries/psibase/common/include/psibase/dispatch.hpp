#pragma once
#include <psibase/AccountNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/api.hpp>
#include <psibase/export.hpp>
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
         R    v((service.*method)(static_cast<decltype(args)>(args)...));
         auto s = find_view_span(v);
         check(s.data() != nullptr, "Cannot handle extensions in returned view");
         raw::setRetval(s.data(), s.size());
      }
      else if constexpr (hasExport<R>)
      {
         std::vector<KvHandle> handles;
         auto                  result = (service.*method)(static_cast<decltype(args)>(args)...);
         psio::shared_view_ptr<exportType<R>> p(psibaseExport(result, handles));
         raw::setRetval(p.data(), p.size());
         exportHandles(handles);
      }
      else
      {
         psio::shared_view_ptr<R> p((service.*method)(static_cast<decltype(args)>(args)...));
         raw::setRetval(p.data(), p.size());
      }
   }

   template <typename F, typename T, std::size_t... I>
   decltype(auto) tuple_call(F&& f, T&& t, std::index_sequence<I...>)
   {
      return f(psio::get<I>(t)...);
   }

   template <typename F, typename T>
   decltype(auto) tuple_call(F&& f, T&& t)
   {
      return tuple_call(f, t,
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

      RecursionGuard<Service> g;

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
             using param_tuple = typename psio::make_param_value_tuple<decltype(member)>::type;

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

#ifndef PSIBASE_GENERATE_SCHEMA

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

#else

#include <iostream>
#include <psibase/schema.hpp>

namespace psibase
{
   template <typename Service>
   int serviceMain(int argc, const char* const* argv)
   {
      bool schema = false;
      for (int i = 1; i < argc; ++i)
      {
         std::string_view arg = argv[i];
         if (arg == "--schema")
         {
            schema = true;
         }
         else
         {
            std::cerr << "Unknown argument: " << arg << std::endl;
            return 1;
         }
      }
      if (schema)
      {
         AccountNumber service = {};
         if constexpr (requires { Service::service; })
         {
            service = Service::service;
         }
         std::cout << psio::convert_to_json(ServiceSchema::make<Service>(service));
      }
      else
      {
         std::cerr << "Missing command" << std::endl;
         return 1;
      }
      return 0;
   }
}  // namespace psibase

#define PSIBASE_DISPATCH(SERVICE)                         \
   int main(int argc, const char* const* argv)            \
   {                                                      \
      return ::psibase::serviceMain<SERVICE>(argc, argv); \
   }                                                      \
   extern "C" void called(psibase::AccountNumber receiver, psibase::AccountNumber sender) {}

#endif

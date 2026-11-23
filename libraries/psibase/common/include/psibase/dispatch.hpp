#pragma once
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodArgs.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/api.hpp>
#include <psibase/export.hpp>
#include <psio/reflect.hpp>
#include <psio/shapes.hpp>
#include <psio1/fracpack.hpp>

#include <array>
#include <optional>

namespace psibase
{

   template <typename T>
   std::span<const char> find_view_span(psio1::view<T> v)
   {
      const char*   start       = psio1::get_view_data(v);
      bool          has_unknown = false;
      bool          known_end;
      std::uint32_t pos = 0;
      if (!psio1::is_packable<std::remove_cv_t<T>>::template unpack<false, true>(
              nullptr, has_unknown, known_end, start, pos, 0xffffffffu))
      {
         static_assert(!psio::is_optional<std::remove_cv_t<T>>::value,
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
   constexpr bool is_view_v<psio1::view<T>> = true;

   /// Calls `f` and sets its result as the return value of the current action
   ///
   /// `R` is the declared return type of the method `f` calls.
   template <typename R, typename F>
   void callMethod(F&& f)
   {
      if constexpr (std::is_void_v<R>)
      {
         f();
      }
      else if constexpr (is_view_v<R>)
      {
         R    v(f());
         auto s = find_view_span(v);
         check(s.data() != nullptr, "Cannot handle extensions in returned view");
         raw::setRetval(s.data(), s.size());
      }
      else if constexpr (hasExport<R>)
      {
         std::vector<KvHandle>                 handles;
         auto                                  result = f();
         psio1::shared_view_ptr<exportType<R>> p(psibaseExport(result, handles));
         raw::setRetval(p.data(), p.size());
         exportHandles(handles);
      }
      else
      {
         psio1::shared_view_ptr<R> p(f());
         raw::setRetval(p.data(), p.size());
      }
   }

   template <typename F, typename T, std::size_t... I>
   decltype(auto) tuple_call(F&& f, T&& t, std::index_sequence<I...>)
   {
      return f(psio1::get<I>(t)...);
   }

   template <typename F, typename T>
   decltype(auto) tuple_call(F&& f, T&& t)
   {
      return tuple_call(f, t,
                        std::make_index_sequence<std::tuple_size_v<std::remove_cvref_t<T>>>());
   }

   /// Maps a method's name to its [MethodNumber]
   ///
   /// The hash `psio::reflect<Service>::index_of_method_hash` looks an
   /// action up by.
   struct MethodNumberOf
   {
      constexpr std::uint64_t operator()(std::string_view name) const
      {
         return MethodNumber{name}.value;
      }
   };

   /// The index of the method of `Service` that `method` names, if any
   ///
   /// The lookup table is built at compile time. Two reflected methods of
   /// one service whose names have the same [MethodNumber] are a compile
   /// error.
   template <typename Service>
   constexpr std::optional<std::size_t> findAction(MethodNumber method)
   {
      return psio::reflect<Service>::template index_of_method_hash<MethodNumberOf>(method.value);
   }

   /// Calls method `I` of `service` with the arguments of `act`
   ///
   /// The arguments are validated, then read through a view. The method's
   /// result is set as the return value of the current action.
   template <typename Service, std::size_t I>
   void callAction(Service& service, const psio1::shared_view_ptr<Action>& act)
   {
      using reflect     = psio::reflect<Service>;
      using method_type = typename reflect::template method_type<I>;
      using result_type = typename reflect::template method_result<I>;
      using param_tuple = MethodArgs<method_type>;

      auto param_data = std::span<const char>{act->rawData().data(), act->rawData().size()};
      psibase::check(psio1::fracpack_validate<param_tuple>(param_data),
                     "invalid argument encoding for " + act->method().unpack().str());

      psio1::view<const param_tuple> param_view(
          psio1::prevalidated<std::span<const char>>{param_data});

      tuple_call(
          [&](auto... args)
          {
             callMethod<result_type>(
                 [&]() -> decltype(auto)
                 {
                    return reflect::template invoke_method<I>(
                        service, std::forward_as_tuple(std::move(args)...));
                 });
          },
          param_view);
   }

   namespace detail
   {
      template <typename Service,
                typename = std::make_index_sequence<psio::reflect<Service>::method_count>>
      struct ActionTable;
      template <typename Service, std::size_t... I>
      struct ActionTable<Service, std::index_sequence<I...>>
      {
         using Call = void (*)(Service&, const psio1::shared_view_ptr<Action>&);
         static constexpr std::array<Call, sizeof...(I)> calls = {&callAction<Service, I>...};
      };
   }  // namespace detail

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
         if constexpr (std::is_constructible<Service, psio1::shared_view_ptr<psibase::Action>>{})
         {
            return Service{act};
         }
         else
         {
            return Service{};
         }
      };
      auto service{makeService()};

      if (auto index = findAction<Service>(act->method().unpack()))
         detail::ActionTable<Service>::calls[*index](service, act);
      else
         abortMessage("unknown service action: " + act->method().unpack().str());
      internal::sender = prevSender;
   }  // dispatch

}  // namespace psibase

#ifndef PSIBASE_GENERATE_SCHEMA

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
         std::cout << psio1::convert_to_json(ServiceSchema::make<Service>(service));
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

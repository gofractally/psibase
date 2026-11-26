#pragma once
#include <psibase/AccountNumber.hpp>
#include <psibase/MethodNumber.hpp>
#include <psibase/Service.hpp>
#include <psibase/api.hpp>
#include <psibase/export.hpp>
#include <psio/reflect.hpp>
#include <psio/shapes.hpp>
#include <psio/pssz.hpp>
#include <psio/pssz_view.hpp>

#include <array>
#include <optional>

namespace psibase
{

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
   /// `Action::rawData` is the packed argument tuple of the method
   /// (`psio::reflect<Service>::method_arg_tuple<I>`). It is validated; the
   /// method then receives each parameter as it declares it: a view, a
   /// `std::string_view` or a span into the bytes, anything else unpacked.
   /// The method's result is set as the return value of the current action.
   /// It is written with the fast write (`psio::call_method_pssz`): nothing
   /// the method's `returns(...)` or the result's type declares is checked
   /// here. The reader of a result is who validates it: a calling service
   /// (`callPacked`, `callUnpacked`), the tester, a client.
   template <typename Service, std::size_t I>
   void callAction(Service& service, const psio::shared_pssz<Action>& act)
   {
      using reflect     = psio::reflect<Service>;
      using result_type = std::remove_cvref_t<typename reflect::template method_result<I>>;

      std::span<const char> args = act->rawData();
      if (auto status = psio::validate_method_args<Service, I>(args); !status.ok())
         abortMessage("invalid argument encoding for " + act->method().unpack().str() + ": " +
                      std::string(status.error().what));

      if constexpr (hasExport<result_type>)
      {
         std::vector<KvHandle> handles;
         auto result = psio::invoke_method_pssz<Service, I>(service, psio::trusted{args});
         auto packed = psio::to_pssz(psibaseExport(result, handles));
         raw::setRetval(packed.data(), packed.size());
         exportHandles(handles);
      }
      else
      {
         std::vector<char> result;
         if (auto status = psio::call_method_pssz<Service, I>(service, psio::trusted{args}, result);
             !status.ok())
            abortMessage("cannot encode the value returned from " +
                         act->method().unpack().str() + ": " + std::string(status.error().what));
         if constexpr (!std::is_void_v<result_type>)
            raw::setRetval(result.data(), result.size());
      }
   }

   namespace detail
   {
      template <typename Service,
                typename = std::make_index_sequence<psio::reflect<Service>::method_count>>
      struct ActionTable;
      template <typename Service, std::size_t... I>
      struct ActionTable<Service, std::index_sequence<I...>>
      {
         using Call = void (*)(Service&, const psio::shared_pssz<Action>&);
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
         if constexpr (std::is_constructible<Service, psio::shared_pssz<psibase::Action>>{})
         {
            return Service{act};
         }
         else
         {
            return Service{};
         }
      };
      auto service{makeService()};

      if (auto index = findAction<Service>(act->method()))
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
         std::vector<ServiceSchema::Collision> collisions;
         auto schema = ServiceSchema::make<Service>(service, &collisions);
         if (!collisions.empty())
         {
            // Two different types of the service have one unqualified
            // name: the schema would name each by its qualified C++
            // spelling. Refused: give one of them another name.
            for (const auto& collision : collisions)
            {
               std::cerr << "schema of " << service.str() << ": the name " << collision.name
                         << " is used by more than one type:";
               for (const auto& type : collision.types)
                  std::cerr << " " << type;
               std::cerr << std::endl;
            }
            return 1;
         }
         schema.checkValid();
         std::cout << psio::to_ijson(schema);
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

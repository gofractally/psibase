#pragma once
#include <psio/reflect.hpp>
#include <psio1/view.hpp>

#include <tuple>
#include <type_traits>

namespace psibase
{
   namespace detail
   {
      template <typename Params>
      struct MethodArgsImpl;
      template <typename... P>
      struct MethodArgsImpl<std::tuple<P...>>
      {
         using type = std::tuple<std::remove_cv_t<psio1::remove_view_t<P>>...>;
      };
   }  // namespace detail

   /// The arguments of a method as they are packed
   ///
   /// `Method` is the type of a pointer to a member function. The result is
   /// a tuple with one element per parameter, each by value: a parameter
   /// declared `const T&` is a `T`, and a parameter declared as a view of
   /// `T` is a `T` too, since a view is read directly from the packed form.
   ///
   /// This is the content of [Action::rawData] for an action, and the
   /// payload of an event.
   template <typename Method>
   using MethodArgs =
       typename detail::MethodArgsImpl<typename psio::method_traits<Method>::params>::type;

   /// The value a method returns as it is packed
   ///
   /// The declared return type without cv-qualifiers; a method that returns
   /// a view of `T` returns a packed `T`. `void` for a method that returns
   /// nothing.
   template <typename Method>
   using MethodResult =
       std::remove_cv_t<psio1::remove_view_t<typename psio::method_traits<Method>::result>>;
}  // namespace psibase

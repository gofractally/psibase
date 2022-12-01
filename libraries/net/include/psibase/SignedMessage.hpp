#pragma once

#include <psio/fracpack.hpp>
#include <vector>

namespace psibase::net
{
#ifndef PSIO_REFLECT_INLINE
#define PSIO_REFLECT_INLINE(name, ...)                      \
   PSIO_REFLECT(name, __VA_ARGS__)                          \
   friend reflect_impl_##name get_reflect_impl(const name&) \
   {                                                        \
      return {};                                            \
   }
#endif

   template <typename Msg>
   struct SignedMessage
   {
      static constexpr auto type = Msg::type;

      Msg data;

      std::vector<char> signature;
      PSIO_REFLECT_INLINE(SignedMessage, definitionWillNotChange(), data, signature)
      std::string to_string() const { return data.to_string(); }
   };

   template <typename T>
   concept NeedsSignature = requires(const T& t)
   {
      {
         t.signer()
         } -> std::same_as<Claim>;
   };
}  // namespace psibase::net

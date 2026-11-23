#pragma once
#include <psio/action_name.hpp>
#include <psio/from_json.hpp>
#include <psio/reflect.hpp>
#include <psio/to_json.hpp>

namespace psibase
{
   /// An eight-byte action/event/reflected name using the generated shared model.
   /// ASCII letters fold to lowercase; digits and underscores remain distinct.
   /// Valid identifiers which do not fit readably use a canonical SHA-256 hash ID.
   struct ActionName
   {
      uint64_t value = 0;
      /// Zero is an unset raw value, not an encoded empty identifier.
      constexpr ActionName() = default;
      /// Raw construction preserves bytes; use try_str() to validate an arbitrary ID.
      constexpr explicit ActionName(uint64_t v) : value(v) {}
      /// Invalid identifiers/hash literals fail instead of silently becoming zero.
      constexpr explicit ActionName(std::string_view text) : value(psio::action_names::encode(text))
      {
      }

      static constexpr std::optional<ActionName> parse(std::string_view text)
      {
         auto result = psio::action_names::try_encode(text);
         return result ? std::optional{ActionName{*result}} : std::nullopt;
      }
      std::optional<std::string> try_str() const { return psio::action_names::try_decode(value); }
      /// Debug/display remains safe for unset or unrecognized raw binary IDs.
      /// This diagnostic is deliberately not accepted by the strict parser.
      std::string str() const
      {
         if (auto result = try_str())
            return std::move(*result);
         constexpr char hex[]  = "0123456789abcdef";
         std::string    result = "<invalid-action-name:";
         for (int i = 15; i >= 0; --i)
            result += hex[(value >> (i * 4)) & 15];
         return result + ">";
      }
      auto operator<=>(const ActionName&) const = default;
      PSIO_REFLECT(ActionName, definitionWillNotChange(), value)
   };
   static_assert(sizeof(ActionName) == sizeof(uint64_t));
   using action_name = ActionName;

   template <typename S>
   void to_json(const ActionName& name, S& stream)
   {
      to_json(name.str(), stream);
   }
   template <typename S>
   void from_json(ActionName& result, S& stream)
   {
      result = ActionName{stream.get_string()};
   }
   inline constexpr bool use_json_string_for_gql(ActionName*)
   {
      return true;
   }
   inline constexpr bool psio_custom_schema(ActionName*)
   {
      return true;
   }

   inline namespace literals
   {
      inline consteval ActionName operator""_action(const char* text, unsigned long size)
      {
         return ActionName{std::string_view{text, size}};
      }
      // Existing source literals use the same new format, not an old decoder.
      inline consteval ActionName operator""_m(const char* text, unsigned long size)
      {
         return ActionName{std::string_view{text, size}};
      }
   }  // namespace literals
}  // namespace psibase

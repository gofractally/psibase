#pragma once

#include <rapidjson/reader.h>
#include <cstdlib>
#include <functional>
#include <optional>
#include <psio/check.hpp>
#include <psio/reflect.hpp>
#include <system_error>
#include <tuple>
#include <variant>
#include <vector>

namespace psio
{
   enum class from_json_error
   {
      no_error,

      expected_end,
      expected_null,
      expected_bool,
      expected_string,
      expected_hex_string,
      hex_string_incorrect_length,
      invalid_signature,
      invalid_name,
      expected_start_object,
      expected_key,
      expected_end_object,
      expected_start_array,
      expected_end_array,
      expected_positive_uint,
      expected_field,
      expected_variant,
      expected_public_key,
      expected_private_key,
      expected_signature,
      expected_number,
      expected_int,
      expected_time_point,
      expected_symbol_code,
      expected_symbol,
      expected_asset,
      invalid_type_for_variant,
      unexpected_field,
      number_out_of_range,
      from_json_no_pair,

      // These are from rapidjson:
      document_empty,
      document_root_not_singular,
      value_invalid,
      object_miss_name,
      object_miss_colon,
      object_miss_comma_or_curly_bracket,
      array_miss_comma_or_square_bracket,
      string_unicode_escape_invalid_hex,
      string_unicode_surrogate_invalid,
      string_escape_invalid,
      string_miss_quotation_mark,
      string_invalid_encoding,
      number_too_big,
      number_miss_fraction,
      number_miss_exponent,
      terminated,
      unspecific_syntax_error,
   };  // from_json_error

   constexpr inline std::string_view error_to_str(from_json_error e)
   {
      switch (e)
      {
            // clang-format off
               case from_json_error::no_error:                            return "No error";

               case from_json_error::expected_end:                        return "Expected end of json";
               case from_json_error::expected_null:                       return "Expected null";
               case from_json_error::expected_bool:                       return "Expected true or false";
               case from_json_error::expected_string:                     return "Expected string";
               case from_json_error::expected_hex_string:                 return "Expected string containing hex";
               case from_json_error::hex_string_incorrect_length:         return "Hex string has incorrect length";
               case from_json_error::invalid_signature:                   return "Invalid signature format";
               case from_json_error::invalid_name:                        return "Invalid name";
               case from_json_error::expected_start_object:               return "Expected {";
               case from_json_error::expected_key:                        return "Expected key";
               case from_json_error::expected_end_object:                 return "Expected }";
               case from_json_error::expected_start_array:                return "Expected [";
               case from_json_error::expected_end_array:                  return "Expected ]";
               case from_json_error::expected_positive_uint:              return "Expected positive integer";
               case from_json_error::expected_field:                      return "Expected field";
               case from_json_error::expected_variant:                    return R"(Expected variant: {"type": value})";
               case from_json_error::expected_public_key:                 return "Expected public key";
               case from_json_error::expected_private_key:                return "Expected private key";
               case from_json_error::expected_signature:                  return "Expected signature";
               case from_json_error::expected_number:                     return "Expected number or boolean";
               case from_json_error::expected_int:                        return "Expected integer";
               case from_json_error::expected_time_point:                 return "Expected time point";
               case from_json_error::expected_symbol_code:                return "Expected symbol code";
               case from_json_error::expected_symbol:                     return "Expected symbol";
               case from_json_error::expected_asset:                      return "Expected asset";
               case from_json_error::invalid_type_for_variant:            return "Invalid type for variant";
               case from_json_error::unexpected_field:                    return "Unexpected field";
               case from_json_error::number_out_of_range:                 return "number is out of range";
               case from_json_error::from_json_no_pair:                   return "from_json does not support std::pair";

               case from_json_error::document_empty:                      return "The document is empty";
               case from_json_error::document_root_not_singular:          return "The document root must not follow by other values";
               case from_json_error::value_invalid:                       return "Invalid value";
               case from_json_error::object_miss_name:                    return "Missing a name for object member";
               case from_json_error::object_miss_colon:                   return "Missing a colon after a name of object member";
               case from_json_error::object_miss_comma_or_curly_bracket:  return "Missing a comma or '}' after an object member";
               case from_json_error::array_miss_comma_or_square_bracket:  return "Missing a comma or ']' after an array element";
               case from_json_error::string_unicode_escape_invalid_hex:   return "Incorrect hex digit after \\u escape in string";
               case from_json_error::string_unicode_surrogate_invalid:    return "The surrogate pair in string is invalid";
               case from_json_error::string_escape_invalid:               return "Invalid escape character in string";
               case from_json_error::string_miss_quotation_mark:          return "Missing a closing quotation mark in string";
               case from_json_error::string_invalid_encoding:             return "Invalid encoding in string";
               case from_json_error::number_too_big:                      return "Number too big to be stored in double";
               case from_json_error::number_miss_fraction:                return "Miss fraction part in number";
               case from_json_error::number_miss_exponent:                return "Miss exponent in number";
               case from_json_error::terminated:                          return "Parsing was terminated";
               case from_json_error::unspecific_syntax_error:             return "Unspecific syntax error";
            // clang-format on

         default:
            return "unknown";
      }
   }

   inline from_json_error convert_error(rapidjson::ParseErrorCode err)
   {
      switch (err)
      {
            // clang-format off
         case rapidjson::kParseErrorNone:                            return from_json_error::no_error;
         case rapidjson::kParseErrorDocumentEmpty:                   return from_json_error::document_empty;
         case rapidjson::kParseErrorDocumentRootNotSingular:         return from_json_error::document_root_not_singular;
         case rapidjson::kParseErrorValueInvalid:                    return from_json_error::value_invalid;
         case rapidjson::kParseErrorObjectMissName:                  return from_json_error::object_miss_name;
         case rapidjson::kParseErrorObjectMissColon:                 return from_json_error::object_miss_colon;
         case rapidjson::kParseErrorObjectMissCommaOrCurlyBracket:   return from_json_error::object_miss_comma_or_curly_bracket;
         case rapidjson::kParseErrorArrayMissCommaOrSquareBracket:   return from_json_error::array_miss_comma_or_square_bracket;
         case rapidjson::kParseErrorStringUnicodeEscapeInvalidHex:   return from_json_error::string_unicode_escape_invalid_hex;
         case rapidjson::kParseErrorStringUnicodeSurrogateInvalid:   return from_json_error::string_unicode_surrogate_invalid;
         case rapidjson::kParseErrorStringEscapeInvalid:             return from_json_error::string_escape_invalid;
         case rapidjson::kParseErrorStringMissQuotationMark:         return from_json_error::string_miss_quotation_mark;
         case rapidjson::kParseErrorStringInvalidEncoding:           return from_json_error::string_invalid_encoding;
         case rapidjson::kParseErrorNumberTooBig:                    return from_json_error::number_too_big;
         case rapidjson::kParseErrorNumberMissFraction:              return from_json_error::number_miss_fraction;
         case rapidjson::kParseErrorNumberMissExponent:              return from_json_error::number_miss_exponent;
         case rapidjson::kParseErrorTermination:                     return from_json_error::terminated;
         case rapidjson::kParseErrorUnspecificSyntaxError:           return from_json_error::unspecific_syntax_error;
            // clang-format on

         default:
            return from_json_error::unspecific_syntax_error;
      }
   }

   enum class json_token_type
   {
      type_unread,
      type_null,
      type_bool,
      type_string,
      type_start_object,
      type_key,
      type_end_object,
      type_start_array,
      type_end_array,
   };

   struct json_token
   {
      json_token_type  type         = {};
      std::string_view key          = {};
      bool             value_bool   = {};
      std::string_view value_string = {};
   };

   class json_token_stream
       : public rapidjson::BaseReaderHandler<rapidjson::UTF8<>, json_token_stream>
   {
     private:
      rapidjson::Reader             reader;
      rapidjson::InsituStringStream ss;

     public:
      json_token current_token;

      // This modifies json (an optimization inside rapidjson)
      json_token_stream(char* json) : ss{json} { reader.IterativeParseInit(); }

      bool complete() { return reader.IterativeParseComplete(); }

      std::reference_wrapper<const json_token> peek_token()
      {
         if (current_token.type != json_token_type::type_unread)
            return current_token;
         else if (reader.IterativeParseNext<
                      rapidjson::kParseInsituFlag | rapidjson::kParseValidateEncodingFlag |
                      rapidjson::kParseIterativeFlag | rapidjson::kParseNumbersAsStringsFlag>(
                      ss, *this))
            return current_token;
         else
            abort_error(convert_error(reader.GetParseErrorCode()));
      }

      void eat_token() { current_token.type = json_token_type::type_unread; }

      void get_end()
      {
         if (current_token.type != json_token_type::type_unread || !complete())
            abort_error(from_json_error::expected_end);
      }

      bool get_null_pred()
      {
         auto t = peek_token();
         if (t.get().type != json_token_type::type_null)
            return false;
         eat_token();
         return true;
      }
      void get_null() { check(get_null_pred(), from_json_error::expected_null); }

      bool get_bool()
      {
         auto t = peek_token();
         if (t.get().type != json_token_type::type_bool)
            abort_error(from_json_error::expected_bool);
         eat_token();
         return t.get().value_bool;
      }

      std::string_view get_string()
      {
         auto t = peek_token();
         if (t.get().type != json_token_type::type_string)
            abort_error(from_json_error::expected_string);
         eat_token();
         return t.get().value_string;
      }

      void get_start_object()
      {
         auto t = peek_token();
         if (t.get().type != json_token_type::type_start_object)
            abort_error(from_json_error::expected_start_object);
         eat_token();
      }

      std::string_view get_key()
      {
         auto t = peek_token();
         if (t.get().type != json_token_type::type_key)
            abort_error(from_json_error::expected_key);
         eat_token();
         return t.get().key;
      }

      std::optional<std::string_view> maybe_get_key()
      {
         auto t = peek_token();
         if (t.get().type != json_token_type::type_key)
            return {};
         eat_token();
         return t.get().key;
      }

      bool get_end_object_pred()
      {
         auto t = peek_token();
         if (t.get().type != json_token_type::type_end_object)
            return false;
         eat_token();
         return true;
      }
      void get_end_object()
      {
         if (!get_end_object_pred())
            abort_error(from_json_error::expected_end_object);
      }

      bool get_start_array_pred()
      {
         auto t = peek_token();
         if (t.get().type != json_token_type::type_start_array)
            return false;
         eat_token();
         return true;
      }
      void get_start_array()
      {
         check(get_start_array_pred(), from_json_error::expected_start_array);
      }

      bool get_end_array_pred()
      {
         auto t = peek_token();
         if (t.get().type != json_token_type::type_end_array)
            return false;
         eat_token();
         return true;
      }
      void get_end_array() { check(get_end_array_pred(), from_json_error::expected_end_array); }

      // BaseReaderHandler methods
      bool Null()
      {
         current_token.type = json_token_type::type_null;
         return true;
      }
      bool Bool(bool v)
      {
         current_token.type       = json_token_type::type_bool;
         current_token.value_bool = v;
         return true;
      }
      bool RawNumber(const char* v, rapidjson::SizeType length, bool copy)
      {
         return String(v, length, copy);
      }
      bool Int(int v) { return false; }
      bool Uint(unsigned v) { return false; }
      bool Int64(int64_t v) { return false; }
      bool Uint64(uint64_t v) { return false; }
      bool Double(double v) { return false; }
      bool String(const char* v, rapidjson::SizeType length, bool)
      {
         current_token.type         = json_token_type::type_string;
         current_token.value_string = {v, length};
         return true;
      }
      bool StartObject()
      {
         current_token.type = json_token_type::type_start_object;
         return true;
      }
      bool Key(const char* v, rapidjson::SizeType length, bool)
      {
         current_token.key  = {v, length};
         current_token.type = json_token_type::type_key;
         return true;
      }
      bool EndObject(rapidjson::SizeType)
      {
         current_token.type = json_token_type::type_end_object;
         return true;
      }
      bool StartArray()
      {
         current_token.type = json_token_type::type_start_array;
         return true;
      }
      bool EndArray(rapidjson::SizeType)
      {
         current_token.type = json_token_type::type_end_array;
         return true;
      }
   };  // json_token_stream

   template <typename SrcIt, typename DestIt>
   [[nodiscard]] bool unhex(DestIt dest, SrcIt begin, SrcIt end)
   {
      auto get_digit = [&](uint8_t& nibble)
      {
         if (*begin >= '0' && *begin <= '9')
            nibble = *begin++ - '0';
         else if (*begin >= 'a' && *begin <= 'f')
            nibble = *begin++ - 'a' + 10;
         else if (*begin >= 'A' && *begin <= 'F')
            nibble = *begin++ - 'A' + 10;
         else
            return false;
         return true;
      };
      while (begin != end)
      {
         uint8_t h, l;
         if (!get_digit(h) || !get_digit(l))
            return false;
         *dest++ = (h << 4) | l;
      }
      return true;
   }

   /// \exclude
   template <typename T, typename S>
   void from_json(T& result, S& stream);

   /// \group from_json_explicit Parse JSON (Explicit Types)
   /// Parse JSON and convert to `result`. These overloads handle specified types.
   template <typename S>
   void from_json(std::string_view& result, S& stream)
   {
      result = stream.get_string();
   }

   /// \group from_json_explicit Parse JSON (Explicit Types)
   /// Parse JSON and convert to `result`. These overloads handle specified types.
   template <typename S>
   void from_json(std::string& result, S& stream)
   {
      result = stream.get_string();
   }

   /// \exclude
   template <typename T, typename S>
   void from_json_int(T& result, S& stream)
   {
      auto r     = stream.get_string();
      auto pos   = r.data();
      auto end   = pos + r.size();
      bool found = false;
      result     = 0;
      T limit;
      T sign;
      if (std::is_signed_v<T> && pos != end && *pos == '-')
      {
         ++pos;
         sign  = -1;
         limit = std::numeric_limits<T>::min();
      }
      else
      {
         sign  = 1;
         limit = std::numeric_limits<T>::max();
      }
      while (pos != end && *pos >= '0' && *pos <= '9')
      {
         T digit = (*pos++ - '0');
         // abs(result) can overflow.  Use -abs(result) instead.
         if (std::is_signed_v<T> && (-sign * limit + digit) / 10 > -sign * result)
            abort_error(from_json_error::number_out_of_range);
         if (!std::is_signed_v<T> && (limit - digit) / 10 < result)
            abort_error(from_json_error::number_out_of_range);
         result = result * 10 + sign * digit;
         found  = true;
      }
      if (pos != end || !found)
         abort_error(from_json_error::expected_int);
   }

   /// \group from_json_explicit
   template <typename S>
   void from_json(uint8_t& result, S& stream)
   {
      return from_json_int(result, stream);
   }

   /// \group from_json_explicit
   template <typename S>
   void from_json(uint16_t& result, S& stream)
   {
      return from_json_int(result, stream);
   }

   /// \group from_json_explicit
   template <typename S>
   void from_json(uint32_t& result, S& stream)
   {
      return from_json_int(result, stream);
   }

   /// \group from_json_explicit
   template <typename S>
   void from_json(uint64_t& result, S& stream)
   {
      return from_json_int(result, stream);
   }

   /// \group from_json_explicit
   template <typename S>
   void from_json(unsigned __int128& result, S& stream)
   {
      return from_json_int(result, stream);
   }

   /// \group from_json_explicit
   template <typename S>
   void from_json(int8_t& result, S& stream)
   {
      return from_json_int(result, stream);
   }

   /// \group from_json_explicit
   template <typename S>
   void from_json(int16_t& result, S& stream)
   {
      return from_json_int(result, stream);
   }

   /// \group from_json_explicit
   template <typename S>
   void from_json(int32_t& result, S& stream)
   {
      return from_json_int(result, stream);
   }

   /// \group from_json_explicit
   template <typename S>
   void from_json(int64_t& result, S& stream)
   {
      return from_json_int(result, stream);
   }

   /// \group from_json_explicit
   template <typename S>
   void from_json(__int128& result, S& stream)
   {
      return from_json_int(result, stream);
   }

   template <typename S>
   void from_json(float& result, S& stream)
   {
      auto sv = stream.get_string();
      if (sv.empty())
         abort_error(from_json_error::expected_number);
      std::string s(sv);  // strtof expects a null-terminated string
      errno = 0;
      char* end;
      result = std::strtof(s.c_str(), &end);
      if (errno || end != s.c_str() + s.size())
         abort_error(from_json_error::expected_number);
   }

   template <typename S>
   void from_json(double& result, S& stream)
   {
      auto sv = stream.get_string();
      if (sv.empty())
         abort_error(from_json_error::expected_number);
      std::string s(sv);
      errno = 0;
      char* end;
      result = std::strtod(s.c_str(), &end);
      if (errno || end != s.c_str() + s.size())
         abort_error(from_json_error::expected_number);
   }

   /// \group from_json_explicit
   template <typename S>
   void from_json(bool& result, S& stream)
   {
      result = stream.get_bool();
   }

   /// \group from_json_explicit
   template <typename T, typename S>
   void from_json(std::vector<T>& result, S& stream)
   {
      stream.get_start_array();
      result.clear();
      while (true)
      {
         auto t = stream.peek_token();
         if (t.get().type == json_token_type::type_end_array)
            break;
         result.emplace_back();
         from_json(result.back(), stream);
      }
      stream.get_end_array();
   }

   /// \group from_json_explicit
   template <typename T, typename S>
   void from_json(std::optional<T>& result, S& stream)
   {
      if (stream.get_null_pred())
      {
         result = std::nullopt;
      }
      else
      {
         result.emplace();
         from_json(*result, stream);
      }
   }

   template <int N = 0, typename... T>
   void set_variant_impl(std::variant<T...>& result, uint32_t type)
   {
      if (type == N)
         result.template emplace<N>();
      else if constexpr (N + 1 < sizeof...(T))
         set_variant_impl<N + 1>(result, type);
   }

   /// \group from_json_explicit
   template <typename... T, typename S>
   void from_json(std::variant<T...>& result, S& stream)
   {
      stream.get_start_object();
      std::string_view  type         = stream.get_key();
      const char* const type_names[] = {get_type_name((T*)nullptr)...};
      uint32_t type_idx = std::find(type_names, type_names + sizeof...(T), type) - type_names;
      if (type_idx >= sizeof...(T))
         abort_error(from_json_error::invalid_type_for_variant);
      set_variant_impl(result, type_idx);
      std::visit([&](auto& x) { from_json(x, stream); }, result);
      stream.get_end_object();
   }

   /**
    *  Accepts null as default value for all tuple elements
    *  Accepts [] with 0 to N as the first n elements and errors if there are too many elements
    *  accepts anything else as the presumed first element
    *
    *  TODO: make robust against adding elements to the tuple by droping all remaining values
    */
   template <typename... T, typename S>
   void from_json(std::tuple<T...>& result, S& stream)
   {
      result = std::tuple<T...>();
      auto t = stream.peek_token();
      if (t.get().type == json_token_type::type_null)
         return;

      if constexpr (sizeof...(T) > 0)
      {
         if (t.get().type != json_token_type::type_start_array)
         {
            from_json(std::get<0>(result), stream);
            return;
         }
      }

      stream.get_start_array();
      tuple_for_each(result,
                     [&](int idx, auto& item)
                     {
                        auto t = stream.peek_token();
                        if (t.get().type == json_token_type::type_end_array)
                           return;
                        from_json(item, stream);
                     });
      stream.get_end_array();
   }

   /// \group from_json_explicit
   template <typename T, typename S>
   auto from_json_hex(std::vector<T>& result, S& stream)
       -> std::enable_if_t<std::is_same_v<T, char> || std::is_same_v<T, unsigned char> ||
                               std::is_same_v<T, signed char>,
                           void>
   {
      auto s = stream.get_string();
      if (s.size() & 1)
         abort_error(from_json_error::expected_hex_string);
      result.clear();
      result.reserve(s.size() / 2);
      if (!unhex(std::back_inserter(result), s.begin(), s.end()))
         abort_error(from_json_error::expected_hex_string);
   }

   template <typename S>
   void from_json(std::vector<char>& obj, S& stream)
   {
      from_json_hex(obj, stream);
   }

   template <typename S>
   void from_json(std::vector<unsigned char>& obj, S& stream)
   {
      from_json_hex(obj, stream);
   }

   template <typename T, std::size_t N, typename S>
      requires std::same_as<T, char> || std::same_as<T, unsigned char> ||
               std::same_as<T, signed char>
   void from_json_hex(std::array<T, N>& result, S& stream)
   {
      auto s = stream.get_string();
      if (s.size() != 2 * N)
         abort_error(from_json_error::expected_hex_string);
      if (!unhex(result.data(), s.begin(), s.end()))
         abort_error(from_json_error::expected_hex_string);
   }

   template <std::size_t N, typename S>
   void from_json(std::array<char, N>& obj, S& stream)
   {
      from_json_hex(obj, stream);
   }

   template <std::size_t N, typename S>
   void from_json(std::array<unsigned char, N>& obj, S& stream)
   {
      from_json_hex(obj, stream);
   }

   /// \exclude
   template <typename S, typename F>
   inline void from_json_object(S& stream, F f)
   {
      stream.get_start_object();
      while (true)
      {
         auto t = stream.peek_token();
         if (t.get().type == json_token_type::type_end_object)
            break;
         auto k = stream.get_key();
         f(k);
      }
      stream.get_end_object();
   }

   template <typename S>
   void from_json_skip_value(S& stream)
   {
      uint64_t depth = 0;
      do
      {
         auto t    = stream.peek_token();
         auto type = t.get().type;
         if (type == json_token_type::type_start_object ||
             type == json_token_type::type_start_array)
            ++depth;
         else if (type == json_token_type::type_end_object ||
                  type == json_token_type::type_end_array)
            --depth;
         stream.eat_token();
      } while (depth);
   }

   template <typename T>
   concept PackValidatable = requires(T obj) {
      {
         clio_validate_packable(obj)
      } -> std::same_as<bool>;
   };

   /// \output_section Parse JSON (Reflected Objects)
   /// Parse JSON and convert to `obj`. This overload works with
   /// [reflected objects](standardese://reflection/).
   template <typename T, typename S>
   void from_json(T& obj, S& stream)
   {
      if constexpr (reflect<T>::is_struct)
      {
         from_json_object(
             stream,
             [&](std::string_view key) -> void
             {
                bool found = false;
                reflect<T>::get(
                    key,
                    [&](auto member)
                    {
                       if constexpr (not std::is_member_function_pointer_v<decltype(member)>)
                       {
                          from_json(obj.*member, stream);
                          found = true;
                       }
                       else
                       {
                       }
                    });
                if (not found)
                {
                   from_json_skip_value(stream);
                }
             });

         if constexpr (PackValidatable<T>)
         {
            if (!clio_validate_packable(obj))
            {
               check(false, std::string(psio::reflect<T>::name) + " failed unpack validation.");
            }
         }
      }
      else
      {
         T::reflection_not_defined;
      }
   }

   /// not implemented, so don't link
   template <typename First, typename Second, typename S>
   void from_json(std::pair<First, Second>& obj, S& stream);

   /// Parse JSON and return result. This overload wraps the other `to_json` overloads.
   template <typename T, typename S>
   T from_json(S& stream)
   {
      T x;
      from_json(x, stream);
      return x;
   }

   template <typename T>
   T convert_from_json(std::string json)
   {
      json_token_stream stream(json.data());
      return from_json<T>(stream);
   }
}  // namespace psio

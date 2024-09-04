#include <psio/from_json.hpp>

namespace psio
{

   std::string_view error_to_str(from_json_error e)
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

   from_json_error convert_error(rapidjson::ParseErrorCode err)
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

   // This modifies json (an optimization inside rapidjson)
   json_token_stream::json_token_stream(char* json) : ss{json}
   {
      reader.IterativeParseInit();
   }

   bool json_token_stream::complete()
   {
      return reader.IterativeParseComplete();
   }

   std::reference_wrapper<const json_token> json_token_stream::peek_token()
   {
      if (current_token.type != json_token_type::type_unread)
         return current_token;
      else if (reader.IterativeParseNext<
                   rapidjson::kParseInsituFlag | rapidjson::kParseValidateEncodingFlag |
                   rapidjson::kParseIterativeFlag | rapidjson::kParseNumbersAsStringsFlag>(ss,
                                                                                           *this))
         return current_token;
      else
         abort_error(convert_error(reader.GetParseErrorCode()));
   }

   void json_token_stream::eat_token()
   {
      current_token.type = json_token_type::type_unread;
   }

   void json_token_stream::get_end()
   {
      if (current_token.type != json_token_type::type_unread || !complete())
         abort_error(from_json_error::expected_end);
   }

   bool json_token_stream::get_null_pred()
   {
      auto t = peek_token();
      if (t.get().type != json_token_type::type_null)
         return false;
      eat_token();
      return true;
   }
   void json_token_stream::get_null()
   {
      check(get_null_pred(), from_json_error::expected_null);
   }

   bool json_token_stream::get_bool()
   {
      auto t = peek_token();
      if (t.get().type != json_token_type::type_bool)
         abort_error(from_json_error::expected_bool);
      eat_token();
      return t.get().value_bool;
   }

   std::string_view json_token_stream::get_string()
   {
      auto t = peek_token();
      if (t.get().type != json_token_type::type_string)
         abort_error(from_json_error::expected_string);
      eat_token();
      return t.get().value_string;
   }

   void json_token_stream::get_start_object()
   {
      auto t = peek_token();
      if (t.get().type != json_token_type::type_start_object)
         abort_error(from_json_error::expected_start_object);
      eat_token();
   }

   std::string_view json_token_stream::get_key()
   {
      auto t = peek_token();
      if (t.get().type != json_token_type::type_key)
         abort_error(from_json_error::expected_key);
      eat_token();
      return t.get().key;
   }

   std::optional<std::string_view> json_token_stream::maybe_get_key()
   {
      auto t = peek_token();
      if (t.get().type != json_token_type::type_key)
         return {};
      eat_token();
      return t.get().key;
   }

   bool json_token_stream::get_end_object_pred()
   {
      auto t = peek_token();
      if (t.get().type != json_token_type::type_end_object)
         return false;
      eat_token();
      return true;
   }
   void json_token_stream::get_end_object()
   {
      if (!get_end_object_pred())
         abort_error(from_json_error::expected_end_object);
   }

   bool json_token_stream::get_start_array_pred()
   {
      auto t = peek_token();
      if (t.get().type != json_token_type::type_start_array)
         return false;
      eat_token();
      return true;
   }
   void json_token_stream::get_start_array()
   {
      check(get_start_array_pred(), from_json_error::expected_start_array);
   }

   bool json_token_stream::get_end_array_pred()
   {
      auto t = peek_token();
      if (t.get().type != json_token_type::type_end_array)
         return false;
      eat_token();
      return true;
   }
   void json_token_stream::get_end_array()
   {
      check(get_end_array_pred(), from_json_error::expected_end_array);
   }

   // BaseReaderHandler methods
   bool json_token_stream::Null()
   {
      current_token.type = json_token_type::type_null;
      return true;
   }
   bool json_token_stream::Bool(bool v)
   {
      current_token.type       = json_token_type::type_bool;
      current_token.value_bool = v;
      return true;
   }
   bool json_token_stream::RawNumber(const char* v, rapidjson::SizeType length, bool copy)
   {
      return String(v, length, copy);
   }
   bool json_token_stream::Int(int v)
   {
      return false;
   }
   bool json_token_stream::Uint(unsigned v)
   {
      return false;
   }
   bool json_token_stream::Int64(int64_t v)
   {
      return false;
   }
   bool json_token_stream::Uint64(uint64_t v)
   {
      return false;
   }
   bool json_token_stream::Double(double v)
   {
      return false;
   }
   bool json_token_stream::String(const char* v, rapidjson::SizeType length, bool)
   {
      current_token.type         = json_token_type::type_string;
      current_token.value_string = {v, length};
      return true;
   }
   bool json_token_stream::StartObject()
   {
      current_token.type = json_token_type::type_start_object;
      return true;
   }
   bool json_token_stream::Key(const char* v, rapidjson::SizeType length, bool)
   {
      current_token.key  = {v, length};
      current_token.type = json_token_type::type_key;
      return true;
   }
   bool json_token_stream::EndObject(rapidjson::SizeType)
   {
      current_token.type = json_token_type::type_end_object;
      return true;
   }
   bool json_token_stream::StartArray()
   {
      current_token.type = json_token_type::type_start_array;
      return true;
   }
   bool json_token_stream::EndArray(rapidjson::SizeType)
   {
      current_token.type = json_token_type::type_end_array;
      return true;
   }
}  // namespace psio

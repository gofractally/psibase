#pragma once

#include <cctype>
#include <charconv>
#include <chrono>
#include <psio/from_json.hpp>
#include <psio/reflect.hpp>
#include <psio/shared_view_ptr.hpp>
#include <psio/stream.hpp>
#include <psio/to_json.hpp>
#include <set>
#include <typeindex>
#include <variant>

namespace psio
{
   struct gql_stream;

   template <typename T>
   constexpr bool use_json_string_for_gql(T*)
   {
      return false;
   }

   inline constexpr bool use_json_string_for_gql(std::vector<char>*)
   {
      return true;
   }

   template <std::size_t Size>
   constexpr bool use_json_string_for_gql(std::array<char, Size>*)
   {
      return true;
   }

   template <std::size_t Size>
   constexpr bool use_json_string_for_gql(std::array<unsigned char, Size>*)
   {
      return true;
   }

   template <std::size_t Size>
   constexpr bool use_json_string_for_gql(std::array<signed char, Size>*)
   {
      return true;
   }

   template <typename Clock, typename Duration>
   constexpr bool use_json_string_for_gql(std::chrono::time_point<Clock, Duration>*)
   {
      return true;
   }

   template <typename T>
   auto get_gql_name(T*) -> std::enable_if_t<use_json_string_for_gql((T*)nullptr), const char*>
   {
      return "String";
   }

   template <typename T, typename OS, typename E>
   auto gql_query(const T&    value,
                  gql_stream& input_stream,
                  OS&         output_stream,
                  const E&    error,
                  bool        allow_unknown_members = false)
       -> std::enable_if_t<use_json_string_for_gql((T*)nullptr), bool>
   {
      to_json(value, output_stream);
      return true;
   }

   template <typename T>
   constexpr bool gql_callable_args(T*)
   {
      return false;
   }

   template <typename T>
   auto get_gql_name(shared_view_ptr<T>*) -> decltype(get_gql_name((T*)nullptr))
   {
      return get_gql_name((T*)nullptr);
   }

   template <typename T>
   struct has_get_gql_name
   {
     private:
      template <typename C>
      static char test(decltype(get_gql_name((C*)nullptr))*);

      template <typename C>
      static long test(...);

     public:
      static constexpr bool value = sizeof(test<T>((const char**)nullptr)) == sizeof(char);
   };

   template <typename T>
   std::string generate_gql_whole_name(const T*, bool is_input, bool is_optional = false);

   template <typename T>
   std::string generate_gql_partial_name(const T*, bool is_input)
   {
      if constexpr (std::is_same_v<T, bool>)
         return "Boolean";
      else if constexpr (std::is_integral_v<T>)
      {
         if constexpr (std::is_signed_v<T> && sizeof(T) <= 4)
            return "Int";
         else if constexpr (std::is_unsigned_v<T> && sizeof(T) <= 2)
            return "Int";
         else if constexpr (sizeof(T) <= 4)
            return "Float";
         else
            return "String";
      }
      else if constexpr (std::is_same_v<T, float> || std::is_same_v<T, double>)
         return "Float";
      else if constexpr (std::is_same_v<T, std::string>)
         return "String";
      else if constexpr (is_std_vector<T>::value)
         return "[" + generate_gql_whole_name((typename T::value_type*)nullptr, is_input) + "]";
      else if constexpr (is_shared_view_ptr_v<T>)
         return generate_gql_partial_name((T*)nullptr, is_input);
      else if constexpr (reflect<T>::is_struct && !has_get_gql_name<T>::value)
         if (is_input)
            return std::string{get_type_name((T*)nullptr)} + "_Input";
         else
            return get_type_name((T*)nullptr);
      else
         return get_gql_name((T*)nullptr);
   }

   template <typename T>
   std::string generate_gql_whole_name(const T*, bool is_input, bool is_optional)
   {
      if constexpr (is_std_optional<T>())
         return generate_gql_whole_name((typename T::value_type*)nullptr, is_input, true);
      else if constexpr (std::is_pointer<T>())
         return generate_gql_whole_name((std::remove_const_t<std::remove_pointer_t<T>>*)nullptr,
                                        is_input, true);
      else if constexpr (is_std_unique_ptr<T>::value)
         return generate_gql_whole_name((typename T::element_type*)nullptr, is_input, true);
      else if constexpr (is_std_reference_wrapper<T>::value)
         return generate_gql_whole_name((typename T::type*)nullptr, is_input, false);
      else if constexpr (is_shared_view_ptr_v<T>)
         return generate_gql_whole_name((typename T::value_type*)nullptr, is_input, false);
      else if (is_optional)
         return generate_gql_partial_name((T*)nullptr, is_input);
      else
         return generate_gql_partial_name((T*)nullptr, is_input) + "!";
   }

   template <typename MemPtr, typename S>
   void fill_gql_schema_fn_types(MemPtr*,
                                 S&                                          stream,
                                 std::set<std::pair<std::type_index, bool>>& defined_types)
   {
      if constexpr (MemPtr::numArgs == 0 &&
                    gql_callable_args((std::remove_cvref_t<typename MemPtr::ReturnType>*)nullptr))
      {
         fill_gql_schema_fn_types((MemberPtrType<decltype(gql_callable_fn(
                                       (typename MemPtr::ReturnType*)nullptr))>*)nullptr,
                                  stream, defined_types);
      }
      else
      {
         forEachType(typename MemPtr::ArgTypes{},
                     [&](auto* p) { fill_gql_schema(p, stream, defined_types, true); });
         fill_gql_schema((std::remove_cvref_t<typename MemPtr::ReturnType>*)nullptr, stream,
                         defined_types, false);
      }
   }

   template <typename MemPtr, typename S>
   void fill_gql_schema_fn(MemPtr*,
                           const char*                  name,
                           std::span<const char* const> argNames,
                           S&                           stream)
   {
      if constexpr (MemPtr::numArgs == 0 &&
                    gql_callable_args((std::remove_cvref_t<typename MemPtr::ReturnType>*)nullptr))
      {
         return fill_gql_schema_fn(
             (MemberPtrType<decltype(gql_callable_fn(                                         //
                  (typename MemPtr::ReturnType*)nullptr))>*)nullptr,                          //
             name,                                                                            //
             *gql_callable_args((std::remove_cvref_t<typename MemPtr::ReturnType>*)nullptr),  //
             stream);
      }
      else
      {
         write_str("    ", stream);
         write_str(name, stream);
         if constexpr (MemPtr::numArgs > 0)
         {
            write_str("(", stream);
            bool first = true;
            forEachNamedType(  //
                typename MemPtr::ArgTypes{}, argNames,
                [&](auto* p, const char* name)
                {
                   if (!first)
                      write_str(" ", stream);
                   write_str(name, stream);
                   write_str(": ", stream);
                   write_str(generate_gql_whole_name(p, true), stream);
                   first = false;
                });
            write_str(")", stream);
         }
         write_str(": ", stream);
         write_str(generate_gql_whole_name(
                       (std::remove_cvref_t<typename MemPtr::ReturnType>*)nullptr, false),
                   stream);
         write_str("\n", stream);
      }
   }

   template <typename T, typename S>
   void fill_gql_schema_dependencies(const T*,
                                     S&                                          stream,
                                     std::set<std::pair<std::type_index, bool>>& defined_types,
                                     bool                                        is_input)
   {
      psio::apply_members(
          (typename reflect<T>::data_members*)nullptr,
          [&](auto... member)
          {
             (fill_gql_schema((std::remove_cvref_t<
                                  typename MemberPtrType<decltype(member)>::ValueType>*)nullptr,
                              stream, defined_types, is_input),
              ...);
          });
      if (!is_input)
         psio::for_each_member_type((typename reflect<T>::member_functions*)nullptr,
                                    [&](auto member)
                                    {
                                       using MemPtr = MemberPtrType<decltype(member)>;
                                       fill_gql_schema_fn_types((MemPtr*)nullptr, stream,
                                                                defined_types);
                                    });
   }

   namespace detail
   {
      template <typename S>
      struct fill_gql_schema_data_member_fn
      {
         template <typename T>
         void operator()(const T*)
         {
            write_str("    ", stream);
            write_str(names[i], stream);
            write_str(": ", stream);
            write_str(generate_gql_whole_name((T*)nullptr, is_input), stream);
            write_str("\n", stream);
            ++i;
         }
         const char* const* names;
         S&                 stream;
         bool               is_input;
         std::size_t        i = 0;
      };

      template <typename S>
      struct fill_gql_schema_member_function_fn
      {
         template <typename F>
         void operator()(F)
         {
            using MemPtr = MemberPtrType<F>;
            if constexpr (MemPtr::isConstFunction)
               fill_gql_schema_fn((MemPtr*)nullptr, *names[i].begin(),
                                  {names[i].begin() + 1, names[i].end()}, stream);
            ++i;
         }
         const std::initializer_list<const char*>* names;
         S&                                        stream;
         std::size_t                               i;
      };
   }  // namespace detail

   template <typename T, typename S>
   void fill_gql_schema_members(const T*, S& stream, bool is_input)
   {
      psio::for_each_member_ptr<true>((T*)nullptr, (typename reflect<T>::data_members*)nullptr,
                                      detail::fill_gql_schema_data_member_fn<S>{
                                          reflect<T>::data_member_names, stream, is_input});
      psio::for_each_member_type(
          (typename reflect<T>::member_functions*)nullptr,
          detail::fill_gql_schema_member_function_fn<S>{reflect<T>::member_function_names, stream});
   }

   template <typename T, typename Source, typename S>
   void fill_gql_schema_as(const T*,
                           const Source*,
                           S&                                          stream,
                           std::set<std::pair<std::type_index, bool>>& defined_types,
                           bool                                        is_input,
                           bool                                        is_query_root)
   {
      if (defined_types.insert({typeid(T), is_input}).second)
      {
         fill_gql_schema_dependencies((Source*)nullptr, stream, defined_types, is_input);
         if (is_input)
            write_str("input ", stream);
         else
            write_str("type ", stream);
         if (is_query_root)
            write_str("Query", stream);
         else
            write_str(generate_gql_partial_name((const T*)nullptr, is_input), stream);
         write_str(" {\n", stream);
         fill_gql_schema_members((Source*)nullptr, stream, is_input);
         write_str("}\n", stream);
      }
   }

   template <typename... T, typename S>
   void fill_gql_schema_impl(const std::variant<T...>*,
                             S&                                          stream,
                             std::set<std::pair<std::type_index, bool>>& defined_types,
                             bool                                        is_input,
                             bool                                        is_query_root)
   {
      (fill_gql_schema((T*)nullptr, stream, defined_types, is_input, false), ...);
      write_str("union ", stream);
      write_str(generate_gql_partial_name((std::variant<T...>*)nullptr, is_input), stream);
      write_str(" =", stream);
      ((write_str("\n  | ", stream),
        write_str(generate_gql_partial_name((T*)nullptr, is_input), stream)),
       ...);
      write_str("\n", stream);
   }

   template <typename T, typename S>
   void fill_gql_schema_impl(const T*,
                             S&                                          stream,
                             std::set<std::pair<std::type_index, bool>>& defined_types,
                             bool                                        is_input,
                             bool                                        is_query_root)
   {
      if constexpr (is_std_optional<T>())
         fill_gql_schema((typename T::value_type*)nullptr, stream, defined_types, is_input);
      else if constexpr (std::is_pointer<T>())
         fill_gql_schema((std::remove_const_t<std::remove_pointer_t<T>>*)nullptr, stream,
                         defined_types, is_input);
      else if constexpr (is_std_unique_ptr_v<T>)
         fill_gql_schema((typename T::element_type*)nullptr, stream, defined_types, is_input);
      else if constexpr (is_std_reference_wrapper_v<T>)
         fill_gql_schema((typename T::type*)nullptr, stream, defined_types, is_input);
      else if constexpr (is_std_vector_v<T>)
         fill_gql_schema((typename T::value_type*)nullptr, stream, defined_types, is_input);
      else if constexpr (is_shared_view_ptr_v<T>)
         fill_gql_schema((typename T::value_type*)nullptr, stream, defined_types, is_input);
      else if constexpr (reflect<T>::is_struct && !has_get_gql_name<T>::value)
         fill_gql_schema_as((T*)nullptr, (T*)nullptr, stream, defined_types, is_input,
                            is_query_root);

   }  // fill_gql_schema

   template <typename T, typename S>
   void fill_gql_schema(const T*, S& stream)
   {
      std::set<std::pair<std::type_index, bool>> defined_types;
      fill_gql_schema((T*)nullptr, stream, defined_types, false, true);
   }

   template <typename T>
   std::string get_gql_schema(T* p = nullptr)
   {
      size_stream ss;
      fill_gql_schema((T*)nullptr, ss);
      std::string      result(ss.size, 0);
      fixed_buf_stream fbs(result.data(), result.size());
      fill_gql_schema((T*)nullptr, fbs);
      check(fbs.pos == fbs.end, error_to_str(stream_error::underrun));
      return result;
   }

   template <typename T, typename S>
   void fill_gql_schema(const T*,
                        S&                                          stream,
                        std::set<std::pair<std::type_index, bool>>& defined_types,
                        bool                                        is_input,
                        bool                                        is_query_root = false)
   {
      fill_gql_schema_impl((T*)nullptr, stream, defined_types, is_input, is_query_root);
   }

   struct gql_stream
   {
      enum token_type
      {
         unstarted,
         eof,
         error,
         punctuator,
         name,
         string,
         integer,
         floating,
      };

      input_stream     input;
      token_type       current_type = unstarted;
      std::string_view current_value;
      char             current_punctuator = 0;

      gql_stream(input_stream input) : input{input} { skip(); }
      gql_stream(const gql_stream&)            = default;
      gql_stream& operator=(const gql_stream&) = default;

      void skip()
      {
         if (current_type == error)
            return;
         current_punctuator = 0;
         current_value      = {};
         while (true)
         {
            auto begin = input.pos;
            if (!input.remaining())
            {
               current_type = eof;
               return;
            }
            switch ((uint8_t)input.pos[0])
            {
               case '\n':
               case '\r':
               case ' ':
               case '\t':
               case ',':
                  ++input.pos;
                  continue;
               case 0xEF:
                  // BOM
                  if (input.remaining() >= 3 && (uint8_t)input.pos[1] == 0xBB &&
                      (uint8_t)input.pos[2] == 0xBF)
                  {
                     input.pos += 3;
                     continue;
                  }
                  break;
               case '#':
                  // note: Doesn't detect and reject code points that the GraphQL spec prohibits
                  while (input.remaining() && (input.pos[0] != '\n' && input.pos[0] != '\r'))
                     ++input.pos;
                  continue;
               case '$':
               case '!':
               case '&':
               case '(':
               case ')':
               case ':':
               case '=':
               case '@':
               case '[':
               case ']':
               case '{':
               case '|':
               case '}':
                  current_punctuator = input.pos[0];
                  ++input.pos;
                  current_value = {begin, size_t(input.pos - begin)};
                  current_type  = punctuator;
                  return;
               case '.':
                  if (input.remaining() >= 3 && input.pos[1] == '.' && input.pos[2] == '.')
                  {
                     current_punctuator = '.';
                     input.pos += 3;
                     current_value = {begin, size_t(input.pos - begin)};
                     current_type  = punctuator;
                     return;
                  }
                  break;
               case '"':
                  // Notes:
                  // * Block strings (""") not currently supported and escape processing not
                  //   currently done; we may have to revisit this if we add either mutation
                  //   support or searches through text fields, or if clients or client
                  //   libraries end up using them unnecessarily
                  // * Doesn't detect and reject unescaped code points that the GraphQL
                  //   spec prohibits
                  if (input.remaining() >= 3 && input.pos[1] == '"' && input.pos[2] == '"')
                  {
                     current_type = error;
                     return;
                  }
                  ++input.pos;
                  while (input.remaining() && input.pos[0] != '"')
                  {
                     auto ch = *input.pos++;
                     if (ch == '\\')
                     {
                        if (!input.remaining())
                           return;
                        ++input.pos;
                     }
                  }
                  if (!input.remaining())
                     return;
                  ++input.pos;
                  current_value = {begin + 1, size_t(input.pos - begin - 2)};
                  current_type  = string;
                  return;
               default:;
            }  // switch (input.pos[0])

            if (input.pos[0] == '_' || std::isalpha((unsigned char)input.pos[0]))
            {
               while (input.remaining() &&
                      (input.pos[0] == '_' || std::isalnum((unsigned char)input.pos[0])))
                  ++input.pos;
               current_value = {begin, size_t(input.pos - begin)};
               current_type  = name;
               return;
            }
            else if (input.pos[0] == '-' || std::isdigit((unsigned char)input.pos[0]))
            {
               current_type = integer;
               if (input.pos[0] == '-')
               {
                  ++input.pos;
                  if (!input.remaining() || !std::isdigit((unsigned char)input.pos[0]))
                  {
                     current_type = error;
                     return;
                  }
               }
               if (input.pos[0] == '0')
                  ++input.pos;
               else
                  while (input.remaining() && std::isdigit((unsigned char)input.pos[0]))
                     ++input.pos;
               if (input.remaining() && input.pos[0] == '.')
               {
                  ++input.pos;
                  current_type = floating;
                  if (!input.remaining() || !std::isdigit((unsigned char)input.pos[0]))
                  {
                     current_type = error;
                     return;
                  }
                  while (input.remaining() && std::isdigit((unsigned char)input.pos[0]))
                     ++input.pos;
               }
               if (input.remaining() && (input.pos[0] == 'e' || input.pos[0] == 'E'))
               {
                  ++input.pos;
                  current_type = floating;
                  if (input.remaining() && input.pos[0] == '-')
                     ++input.pos;
                  if (!input.remaining() || !std::isdigit((unsigned char)input.pos[0]))
                  {
                     current_type = error;
                     return;
                  }
                  while (input.remaining() && std::isdigit((unsigned char)input.pos[0]))
                     ++input.pos;
               }
               if (input.remaining() &&
                   (input.pos[0] == '_' || std::isalnum((unsigned char)input.pos[0])))
               {
                  current_type = error;
                  return;
               }
               current_value = {begin, size_t(input.pos - begin)};
               return;
            }  // numbers
            else
            {
               current_value = {begin, size_t(input.pos - begin)};
               current_type  = error;
               return;
            }
         }  // while (true)
      }  // skip()
   };  // gql_stream

   template <typename E>
   auto gql_parse_arg(std::string& arg, gql_stream& input_stream, const E& error)
   {
      if (input_stream.current_type == gql_stream::string)
      {
         arg = input_stream.current_value;
         input_stream.skip();
         return true;
      }
      return error("expected String");
   }

   template <typename T, typename E>
   auto gql_parse_arg(std::vector<T>& arg, gql_stream& input_stream, const E& error)
   {
      if (input_stream.current_punctuator != '[')
         return error("expected [");
      input_stream.skip();
      while (input_stream.current_punctuator != ']')
      {
         T v;
         if (!gql_parse_arg(v, input_stream, error))
            return false;
         arg.push_back(std::move(v));
      }
      input_stream.skip();
      return true;
   }

   template <typename T, typename E>
   auto gql_parse_arg(T& arg, gql_stream& input_stream, const E& error)
       -> std::enable_if_t<reflect<T>::is_struct && !use_json_string_for_gql((T*)nullptr), bool>
   {
      if (input_stream.current_punctuator != '{')
         return error("expected {");
      input_stream.skip();
      bool ok = true;

      /// TODO: require non-optional fields to be set
      while (input_stream.current_type == gql_stream::name)
      {
         auto field_name = input_stream.current_value;
         input_stream.skip();
         if (input_stream.current_punctuator != ':')
            return error("expected :");
         input_stream.skip();

         bool found = psio::get_data_member<T>(
             field_name, [&](auto member) { gql_parse_arg(arg.*member, input_stream, error); });

         if (!ok)
            return false;

         if (!found)
            return error((std::string)field_name + " not found");
      }
      if (input_stream.current_punctuator != '}')
         return error("expected }");
      input_stream.skip();

      return true;  //error("unable to parse object");
   }

   template <typename T, typename E>
   auto gql_parse_arg(T& arg, gql_stream& input_stream, const E& error)
       -> std::enable_if_t<std::is_arithmetic_v<T> || std::is_same_v<T, bool>, bool>
   {
      if constexpr (std::is_same_v<T, bool>)
      {
         if (input_stream.current_type == gql_stream::name && input_stream.current_value == "true")
         {
            input_stream.skip();
            arg = true;
            return true;
         }
         else if (input_stream.current_type == gql_stream::name &&
                  input_stream.current_value == "false")
         {
            input_stream.skip();
            arg = false;
            return true;
         }
         else
            return error("expected Boolean");
      }
      else
      {
         if (input_stream.current_type != gql_stream::integer &&
             input_stream.current_type != gql_stream::floating &&
             input_stream.current_type != gql_stream::string)
            return error("expected number or stringified number");
         auto begin  = input_stream.current_value.data();
         auto end    = begin + input_stream.current_value.size();
         auto result = std::from_chars<T>(begin, end, arg);
         if (result.ec == std::errc{} && result.ptr == end)
         {
            input_stream.skip();
            return true;
         }
         if (result.ec == std::errc::result_out_of_range)
            return error("number is out of range");
         return error("expected number or stringified number");
      }
   }

   template <int i, typename... Args>
   void gql_mark_optional(std::tuple<Args...>& args, bool filled[])
   {
      if constexpr (i < sizeof...(Args))
      {
         constexpr bool is_optional =
             is_std_optional<std::remove_cvref_t<decltype(std::get<i>(args))>>();
         if constexpr (is_optional)
            filled[i] |= true;
         gql_mark_optional<i + 1>(args, filled);
      }
   }

   template <int i, typename... Args, typename E>
   bool gql_parse_args(std::tuple<Args...>&         args,
                       bool                         filled[],
                       bool&                        found,
                       gql_stream&                  input_stream,
                       const E&                     error,
                       std::span<const char* const> arg_names)
   {
      if constexpr (i < sizeof...(Args))
      {
         if (i >= arg_names.size())
            return error("mismatched arg names"), false;

         constexpr bool is_opt =
             is_std_optional_v<std::remove_cvref_t<decltype(std::get<i>(args))>>;
         if (input_stream.current_value != std::data(arg_names)[i])
            return gql_parse_args<i + 1>(args, filled, found, input_stream, error, arg_names);
         input_stream.skip();
         if (input_stream.current_punctuator != ':')
            return error("expected :");
         if (filled[i])
            return error("duplicate arg");
         input_stream.skip();
         if constexpr (is_opt)
         {
            if (input_stream.current_type == gql_stream::name &&
                input_stream.current_value == "null")
               input_stream.skip();
            else
            {
               std::get<i>(args).emplace();
               if (!gql_parse_arg(*std::get<i>(args), input_stream, error))
                  return false;
            }
         }
         else if (!gql_parse_arg(std::get<i>(args), input_stream, error))
            return false;
         filled[i] = true;
         found     = true;
         return true;
      }
      return false;
   }

   template <int i, typename... Args, typename E>
   bool gql_parse_args(std::tuple<Args...>& args,
                       bool                 filled[],
                       bool&                found,
                       gql_stream&          input_stream,
                       const E&             error)
   {
      static_assert(i == sizeof...(Args), "mismatched arg names");
      return true;
   }

   template <typename E>
   bool gql_skip_selection_set(gql_stream& input_stream, const E& error)
   {
      if (input_stream.current_punctuator != '{')
         return true;
      input_stream.skip();
      while (true)
      {
         if (input_stream.current_type == gql_stream::eof)
            return error("expected }");
         else if (input_stream.current_punctuator == '{')
         {
            if (!gql_skip_selection_set(input_stream, error))
               return false;
         }
         else if (input_stream.current_punctuator == '}')
         {
            input_stream.skip();
            return true;
         }
         else if (input_stream.current_punctuator == '(')
         {
            if (!gql_skip_args(input_stream, error))
               return false;
         }
         else
            input_stream.skip();
      }
   }  // gql_skip_selection_set

   template <typename E>
   bool gql_skip_args(gql_stream& input_stream, const E& error)
   {
      if (input_stream.current_punctuator != '(')
         return true;
      input_stream.skip();
      while (true)
      {
         if (input_stream.current_type == gql_stream::eof)
            return error("expected )");
         else if (input_stream.current_punctuator == '(')
         {
            if (!gql_skip_args(input_stream, error))
               return false;
         }
         else if (input_stream.current_punctuator == ')')
         {
            input_stream.skip();
            return true;
         }
         else if (input_stream.current_punctuator == '{')
         {
            if (!gql_skip_selection_set(input_stream, error))
               return false;
         }
         else
            input_stream.skip();
      }
   }  // gql_skip_args

   template <typename T, typename OS, typename E>
   auto gql_query(const T&    value,
                  gql_stream& input_stream,
                  OS&         output_stream,
                  const E&    error,
                  bool        allow_unknown_members = false)
       -> std::enable_if_t<std::is_arithmetic_v<T> || std::is_same_v<T, std::string>, bool>;

   template <typename T, typename OS, typename E>
   auto gql_query(const T&    value,
                  gql_stream& input_stream,
                  OS&         output_stream,
                  const E&    error,
                  bool        allow_unknown_members = false)
       -> std::enable_if_t<is_std_optional<T>() || std::is_pointer<T>() || is_std_unique_ptr<T>(),
                           bool>;

   template <typename T, typename OS, typename E>
   auto gql_query(const T&    value,
                  gql_stream& input_stream,
                  OS&         output_stream,
                  const E&    error,
                  bool        allow_unknown_members = false)
       -> std::enable_if_t<is_std_reference_wrapper_v<T>, bool>;

   template <typename T, typename OS, typename E>
   auto gql_query(const T&    value,
                  gql_stream& input_stream,
                  OS&         output_stream,
                  const E&    error,
                  bool        allow_unknown_members = false)
       -> std::enable_if_t<is_std_vector<T>::value && !use_json_string_for_gql((T*)nullptr), bool>;

   template <typename T, typename OS, typename E>
   auto gql_query(const shared_view_ptr<T>& value,
                  gql_stream&               input_stream,
                  OS&                       output_stream,
                  const E&                  error,
                  bool                      allow_unknown_members = false);

   template <typename T, typename OS, typename E>
   auto gql_query(const T&    value,
                  gql_stream& input_stream,
                  OS&         output_stream,
                  const E&    error,
                  bool        allow_unknown_members = false)
       -> std::enable_if_t<reflect<T>::is_struct and not has_get_gql_name<T>::value, bool>;

   template <typename T, typename OS, typename E>
   auto gql_query(const T&    value,
                  gql_stream& input_stream,
                  OS&         output_stream,
                  const E&    error,
                  bool        allow_unknown_members)
       -> std::enable_if_t<std::is_arithmetic_v<T> || std::is_same_v<T, std::string>, bool>
   {
      to_json(value, output_stream);
      return true;
   }

   template <typename T, typename OS, typename E>
   auto gql_query(const T&    value,
                  gql_stream& input_stream,
                  OS&         output_stream,
                  const E&    error,
                  bool        allow_unknown_members)
       -> std::enable_if_t<is_std_optional<T>() || std::is_pointer<T>() || is_std_unique_ptr<T>(),
                           bool>
   {
      if (value)
         return gql_query(*value, input_stream, output_stream, error, allow_unknown_members);
      write_str("null", output_stream);
      return gql_skip_selection_set(input_stream, error);
   }

   template <typename T, typename OS, typename E>
   auto gql_query(const T&    value,
                  gql_stream& input_stream,
                  OS&         output_stream,
                  const E&    error,
                  bool        allow_unknown_members)
       -> std::enable_if_t<is_std_reference_wrapper_v<T>, bool>
   {
      return gql_query(value.get(), input_stream, output_stream, error, allow_unknown_members);
   }

   template <typename T, typename OS, typename E>
   auto gql_query(const T&    value,
                  gql_stream& input_stream,
                  OS&         output_stream,
                  const E&    error,
                  bool        allow_unknown_members)
       -> std::enable_if_t<is_std_vector<T>::value && !use_json_string_for_gql((T*)nullptr), bool>
   {
      output_stream.write('[');
      bool first = true;
      for (auto& v : value)
      {
         if (first)
            increase_indent(output_stream);
         else
            output_stream.write(',');
         write_newline(output_stream);
         first     = false;
         auto copy = input_stream;
         if (!gql_query(v, copy, output_stream, error, allow_unknown_members))
            return false;
      }
      if (!gql_skip_selection_set(input_stream, error))
         return false;
      if (!first)
      {
         decrease_indent(output_stream);
         write_newline(output_stream);
      }
      output_stream.write(']');
      return true;
   }

   template <typename T, typename OS, typename E>
   auto gql_query(const shared_view_ptr<T>& value,
                  gql_stream&               input_stream,
                  OS&                       output_stream,
                  const E&                  error,
                  bool                      allow_unknown_members)
   {
      // TODO: validate fracpack
      return gql_query(value.unpack(), input_stream, output_stream, error, allow_unknown_members);
   }

   template <typename T, typename MPtr, typename OS, typename E>
   bool gql_query_fn(const T&                     value,
                     std::span<const char* const> argNames,
                     MPtr                         mptr,
                     gql_stream&                  input_stream,
                     OS&                          output_stream,
                     const E&                     error,
                     bool                         allow_unknown_members)
   {
      using args_tuple = TupleFromTypeList<typename MemberPtrType<MPtr>::SimplifiedArgTypes>;
      static constexpr int num_args = std::tuple_size_v<args_tuple>;
      using ReturnType              = std::remove_cvref_t<typename MemberPtrType<MPtr>::ReturnType>;
      if constexpr (num_args == 0 && gql_callable_args((ReturnType*)nullptr))
      {
         return gql_query_fn((value.*mptr)(), *gql_callable_args((ReturnType*)nullptr),
                             gql_callable_fn((ReturnType*)nullptr), input_stream, output_stream,
                             error, allow_unknown_members);
      }
      else
      {
         args_tuple args;
         bool       filled[num_args] = {};
         if (input_stream.current_punctuator == '(')
         {
            input_stream.skip();
            if (input_stream.current_punctuator == ')')
               return error("empty arg list");
            while (input_stream.current_type == gql_stream::name)
            {
               bool found = false;
               if (!gql_parse_args<0>(args, filled, found, input_stream, error, argNames))
                  return false;
               if (!found)
                  return error("unknown arg '" + (std::string)input_stream.current_value + "'");
            }
            if (input_stream.current_punctuator != ')')
               return error("expected )");
            input_stream.skip();
         }
         gql_mark_optional<0>(args, filled);
         if constexpr (num_args > 0)
            for (int i = 0; i < num_args; ++i)
               if (!filled[i])
                  return error("function missing required arg '" +
                               std::string(std::data(argNames)[i]) + "'");
         auto result = std::apply(
             [&](auto&&... args) { return std::invoke(mptr, value, std::move(args)...); }, args);
         if (!gql_query(result, input_stream, output_stream, error, allow_unknown_members))
            return false;
         return true;
      }
   }  // gql_query_fn

   namespace detail
   {
      template <typename OS>
      void write_field_name(std::string_view name, bool& first, OS& output_stream)
      {
         if (first)
         {
            increase_indent(output_stream);
            first = false;
         }
         else
         {
            output_stream.write(',');
         }
         write_newline(output_stream);
         to_json(name, output_stream);
         write_colon(output_stream);
      }
   }  // namespace detail

   // T is the actual type
   // ContextT is the type declared in the GraphQL document
   template <typename ContextT, typename T, typename OS, typename E>
   auto gql_query_inline(ContextT*,
                         const T&    value,
                         gql_stream& input_stream,
                         OS&         output_stream,
                         const E&    error,
                         bool        allow_unknown_members,
                         bool&       first)
   {
      if (input_stream.current_punctuator != '{')
         return error("expected {");
      input_stream.skip();
      while (true)
      {
         if (input_stream.current_type == gql_stream::punctuator &&
             input_stream.current_punctuator == '.')
         {
            // parse inline fragments
            input_stream.skip();
            if (input_stream.current_type != gql_stream::name)
               return error("expected fragment after ...");
            if (input_stream.current_value != "on")
               return error("not implemented: fragments");
            input_stream.skip();
            if (input_stream.current_value == generate_gql_partial_name((T*)nullptr, false))
            {
               input_stream.skip();
               if (!gql_query_inline((T*)nullptr, value, input_stream, output_stream, error,
                                     allow_unknown_members, first))
                  return false;
            }
            else
            {
               input_stream.skip();
               if (!gql_skip_selection_set(input_stream, error))
                  return false;
            }
            continue;
         }
         else if (input_stream.current_type != gql_stream::name)
         {
            break;
         }
         bool ok         = true;
         auto alias      = input_stream.current_value;
         auto field_name = alias;
         input_stream.skip();
         if (input_stream.current_punctuator == ':')
         {
            input_stream.skip();
            if (input_stream.current_type != gql_stream::name)
               return error("expected name after :");
            field_name = input_stream.current_value;
            input_stream.skip();
         }

         bool found =
             psio::get_data_member<T>(field_name,
                                      [&](auto member)
                                      {
                                         detail::write_field_name(alias, first, output_stream);
                                         ok &= gql_query(value.*member, input_stream, output_stream,
                                                         error, allow_unknown_members);
                                      });
         if (!found)
         {
            psio::get_member_function<T>(
                field_name,
                [&](auto member, std::span<const char* const> names)
                {
                   if constexpr (psio::MemberPtrType<decltype(member)>::isConstFunction)
                   {
                      found = true;
                      detail::write_field_name(alias, first, output_stream);
                      ok &= gql_query_fn(value, names.subspan(1), member, input_stream,
                                         output_stream, error, allow_unknown_members);
                   }
                });
         }

         if (!ok)
            return false;
         if (!found)
         {
            if (!allow_unknown_members)
               return error((std::string)field_name + " not found");
            if (!gql_skip_args(input_stream, error))
               return false;
            if (!gql_skip_selection_set(input_stream, error))
               return false;
         }
      }
      if (input_stream.current_punctuator != '}')
         return error("expected }");
      input_stream.skip();
      return true;
   }

   template <typename T, typename OS, typename E>
   auto gql_query(const T&    value,
                  gql_stream& input_stream,
                  OS&         output_stream,
                  const E&    error,
                  bool        allow_unknown_members)
       -> std::enable_if_t<reflect<T>::is_struct and not has_get_gql_name<T>::value, bool>
   {
      if (input_stream.current_punctuator != '{')
         return error("expected {");
      bool first = true;
      output_stream.write('{');
      if (!gql_query_inline((T*)nullptr, value, input_stream, output_stream, error,
                            allow_unknown_members, first))
      {
         return false;
      }
      if (!first)
      {
         decrease_indent(output_stream);
         write_newline(output_stream);
      }
      output_stream.write('}');
      return true;
   }

   template <typename... T, typename OS, typename E>
   auto gql_query(const std::variant<T...>& value,
                  gql_stream&               input_stream,
                  OS&                       output_stream,
                  const E&                  error,
                  bool                      allow_unknown_members)
   {
      if (input_stream.current_punctuator != '{')
         return error("expected {");
      bool first = true;
      output_stream.write('{');
      if (!std::visit(
              [&](const auto& v)
              {
                 return gql_query_inline((std::variant<T...>*)nullptr, v, input_stream,
                                         output_stream, error, allow_unknown_members, first);
              },
              value))
      {
         return false;
      }
      if (!first)
      {
         decrease_indent(output_stream);
         write_newline(output_stream);
      }
      output_stream.write('}');
      return true;
   }

   template <typename T, typename OS, typename E>
   bool gql_query_root(const T&    value,
                       gql_stream& input_stream,
                       OS&         output_stream,
                       const E&    error,
                       bool        allow_unknown_members)
   {
      if (input_stream.current_type == gql_stream::name)
      {
         if (input_stream.current_value == "query")
         {
            input_stream.skip();
            if (input_stream.current_type == gql_stream::name)
               input_stream.skip();
            if (input_stream.current_punctuator == '(')
               return error("variables not supported");
            if (input_stream.current_punctuator == '@')
               return error("directives not supported");
         }
         else if (input_stream.current_value == "subscriptions")
            return error("subscriptions not supported");
         else if (input_stream.current_value == "mutation")
            return error("mutations not supported");
         else if (input_stream.current_value == "fragment")
            return error("fragments not supported");
         else
            return error("expected query");
      }
      if (!gql_query(value, input_stream, output_stream, error, allow_unknown_members))
         return false;
      if (input_stream.current_type == gql_stream::eof)
         return true;
      if (input_stream.current_type == gql_stream::name)
      {
         if (input_stream.current_value == "query")
            return error("multiple queries not supported");
         if (input_stream.current_value == "fragment")
            return error("fragments not supported");
         if (input_stream.current_value == "subscription")
            return error("subscriptions not supported");
         if (input_stream.current_value == "mutation")
            return error("mutations not supported");
      }
      return error("expected end of input");
   }

   template <typename Stream = string_stream, typename T>
   std::string gql_query(const T&         value,
                         std::string_view query,
                         std::string_view variables,
                         bool             allow_unknown_members = false)
   {
      gql_stream  input_stream{query};
      std::string result;
      Stream      output_stream(result);
      output_stream.write('{');
      increase_indent(output_stream);
      write_newline(output_stream);
      write_str("\"data\": ", output_stream);
      std::string error;
      bool        ok = true;
      if (!variables.empty())
      {
         error = "variables not supported; argument must be empty";
         ok    = false;
      }
      else
         ok = gql_query_root(
             value, input_stream, output_stream,
             [&](const auto& e)
             {
                error = e;
                return false;
             },
             allow_unknown_members);
      if (!ok)
      {
         result.clear();
         Stream error_stream(result);
         error_stream.write('{');
         increase_indent(error_stream);
         write_newline(error_stream);
         write_str("\"errors\": {", error_stream);
         increase_indent(error_stream);
         write_newline(error_stream);
         write_str("\"message\": ", error_stream);
         to_json(error, error_stream);
         decrease_indent(error_stream);
         write_newline(error_stream);
         error_stream.write('}');
         decrease_indent(error_stream);
         write_newline(error_stream);
         error_stream.write('}');
         return result;
      }
      decrease_indent(output_stream);
      write_newline(output_stream);
      output_stream.write('}');
      return result;
   }

   template <typename T>
   std::string format_gql_query(const T&         value,
                                std::string_view query,
                                bool             allow_unknown_members = false)
   {
      return gql_query<pretty_stream<string_stream>>(value, query, allow_unknown_members);
   }

   template <typename T, typename E>
   auto gql_parse_arg(T& arg, gql_stream& input_stream, const E& error)
       -> std::enable_if_t<use_json_string_for_gql((T*)nullptr), bool>
   {
      if (input_stream.current_type == gql_stream::string)
      {
         // TODO: prevent abort
         // TODO: remove double conversion
         arg = psio::convert_from_json<T>(psio::convert_to_json(input_stream.current_value));
         input_stream.skip();
         return true;
      }
      return error("expected String");
   }
}  // namespace psio

#pragma once

#include <cctype>
#include <charconv>
#include <psio/reflect.hpp>
#include <psio/stream.hpp>
#include <psio/to_json.hpp>
#include <set>
#include <typeindex>

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

   template <typename T>
   auto get_gql_name(T*) -> std::enable_if_t<use_json_string_for_gql((T*)nullptr), const char*>
   {
      return "String";
   }

   template <typename T, typename OS, typename E>
   auto gql_query(const T& value, gql_stream& input_stream, OS& output_stream, const E& error)
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

   template <typename Raw>
   std::string generate_gql_whole_name(Raw*, bool is_optional = false);

   template <typename Raw>
   std::string generate_gql_partial_name(Raw*)
   {
      using T = remove_cvref_t<Raw>;
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
         return "[" + generate_gql_whole_name((typename T::value_type*)nullptr) + "]";
      else if constexpr (reflect<T>::is_struct && !has_get_gql_name<T>::value)
         return get_type_name((T*)nullptr);
      else
         return get_gql_name((T*)nullptr);
   }

   template <typename Raw>
   std::string generate_gql_whole_name(Raw*, bool is_optional)
   {
      using T = remove_cvref_t<Raw>;
      if constexpr (is_std_optional<T>())
         return generate_gql_whole_name((typename T::value_type*)nullptr, true);
      else if constexpr (std::is_pointer<T>())
         return generate_gql_whole_name((std::remove_const_t<std::remove_pointer_t<T>>*)nullptr,
                                        true);
      else if constexpr (is_std_unique_ptr<T>::value)
         return generate_gql_whole_name((typename T::element_type*)nullptr, true);
      else if constexpr (is_std_reference_wrapper<T>::value)
         return generate_gql_whole_name((typename T::type*)nullptr, false);
      else if (is_optional)
         return generate_gql_partial_name((Raw*)nullptr);
      else
         return generate_gql_partial_name((Raw*)nullptr) + "!";
   }

   template <typename MemPtr, typename S>
   void fill_gql_schema_fn_types(MemPtr*, S& stream, std::set<std::type_index>& defined_types)
   {
      if constexpr (MemPtr::numArgs == 0 &&
                    gql_callable_args((std::remove_cvref_t<typename MemPtr::ReturnType>*)nullptr))
      {
         fill_gql_schema_fn_types(
             (MemberPtrType<decltype(&MemPtr::ReturnType::operator())>*)nullptr, stream,
             defined_types);
      }
      else
      {
         forEachType(typename MemPtr::ArgTypes{},
                     [&](auto* p) { fill_gql_schema(p, stream, defined_types); });
         fill_gql_schema((std::remove_cvref_t<typename MemPtr::ReturnType>*)nullptr, stream,
                         defined_types);
      }
   }

   template <typename Raw, typename MemPtr, typename S>
   void fill_gql_schema_fn(Raw*,
                           MemPtr*,
                           const char*                  name,
                           std::span<const char* const> argNames,
                           S&                           stream)
   {
      if constexpr (MemPtr::numArgs == 0 &&
                    gql_callable_args((std::remove_cvref_t<typename MemPtr::ReturnType>*)nullptr))
      {
         return fill_gql_schema_fn(
             (std::remove_cvref_t<typename MemPtr::ReturnType>*)nullptr,                      //
             (MemberPtrType<decltype(&MemPtr::ReturnType::operator())>*)nullptr,              //
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
                   write_str(generate_gql_whole_name(p), stream);
                   first = false;
                });
            write_str(")", stream);
         }
         write_str(": ", stream);
         write_str(
             generate_gql_whole_name((std::remove_cvref_t<typename MemPtr::ReturnType>*)nullptr),
             stream);
         write_str("\n", stream);
      }
   }

   template <typename Raw, typename S>
   void fill_gql_schema(Raw*,
                        S&                         stream,
                        std::set<std::type_index>& defined_types,
                        bool                       is_query_root = false)
   {
      using T = std::remove_cvref_t<Raw>;
      if constexpr (is_std_optional<T>())
         fill_gql_schema((typename T::value_type*)nullptr, stream, defined_types);
      else if constexpr (std::is_pointer<T>())
         fill_gql_schema((std::remove_const_t<std::remove_pointer_t<T>>*)nullptr, stream,
                         defined_types);
      else if constexpr (is_std_unique_ptr_v<T>)
         fill_gql_schema((typename T::element_type*)nullptr, stream, defined_types);
      else if constexpr (is_std_reference_wrapper_v<T>)
         fill_gql_schema((typename T::type*)nullptr, stream, defined_types);
      else if constexpr (is_std_vector_v<T>)
         fill_gql_schema((typename T::value_type*)nullptr, stream, defined_types);
      else if constexpr (reflect<T>::is_struct && !has_get_gql_name<T>::value)
      {
         if (defined_types.insert(typeid(T)).second)
         {
            reflect<T>::for_each(
                [&](const psio::meta& meta, auto member)
                {
                   using MemPtr = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!MemPtr::isFunction)
                   {
                      fill_gql_schema((remove_cvref_t<typename MemPtr::ValueType>*)nullptr, stream,
                                      defined_types);
                   }
                });
            reflect<T>::for_each(
                [&](const psio::meta& meta, auto member)
                {
                   using MemPtr = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (MemPtr::isConstFunction)
                      fill_gql_schema_fn_types((MemPtr*)nullptr, stream, defined_types);
                });
            write_str("type ", stream);
            if (is_query_root)
               write_str("Query", stream);
            else
               write_str(generate_gql_partial_name((Raw*)nullptr), stream);
            write_str(" {\n", stream);
            reflect<T>::for_each(
                [&](const psio::meta& meta, auto member)
                {
                   using MemPtr = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!MemPtr::isFunction)
                   {
                      write_str("    ", stream);
                      write_str(meta.name, stream);
                      write_str(": ", stream);
                      write_str(generate_gql_whole_name(
                                    (std::remove_cvref_t<typename MemPtr::ValueType>*)nullptr),
                                stream);
                      write_str("\n", stream);
                   }
                });
            reflect<T>::for_each(
                [&](const psio::meta& meta, auto member)
                {
                   using MemPtr = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (MemPtr::isConstFunction)
                      fill_gql_schema_fn((Raw*)nullptr, (MemPtr*)nullptr, meta.name,
                                         meta.param_names, stream);
                });
            write_str("}\n", stream);
         }
      }
   }  // fill_gql_schema

   template <typename Raw, typename S>
   void fill_gql_schema(Raw*, S& stream)
   {
      std::set<std::type_index> defined_types;
      fill_gql_schema((Raw*)nullptr, stream, defined_types, true);
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
      char             current_puncuator = 0;

      gql_stream(input_stream input) : input{input} { skip(); }
      gql_stream(const gql_stream&)            = default;
      gql_stream& operator=(const gql_stream&) = default;

      void skip()
      {
         if (current_type == error)
            return;
         current_puncuator = 0;
         current_value     = {};
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
                  current_puncuator = input.pos[0];
                  ++input.pos;
                  current_value = {begin, size_t(input.pos - begin)};
                  current_type  = punctuator;
                  return;
               case '.':
                  if (input.remaining() >= 3 && input.pos[1] == '.' && input.pos[2] == '.')
                  {
                     current_puncuator = '.';
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
      }     // skip()
   };       // gql_stream

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

   // TODO: schema support for these types as inputs
   template <typename T, typename E>
   auto gql_parse_arg(T& arg, gql_stream& input_stream, const E& error)
       -> std::enable_if_t<reflect<T>::is_struct, bool>
   {
      if (input_stream.current_puncuator != '{')
         return error("expected {");
      input_stream.skip();
      bool ok = true;

      /// TODO: require non-optional fields to be set
      while (input_stream.current_type == gql_stream::name)
      {
         auto field_name = input_stream.current_value;
         input_stream.skip();
         if (input_stream.current_puncuator != ':')
            return error("expected :");
         input_stream.skip();

         bool found =
             reflect<T>::get_by_name(hash_name(field_name), [&](const meta& m, auto member)
                                     { gql_parse_arg(arg.*member(&arg), input_stream, error); });

         if (!ok)
            return false;

         if (!found)
            return error((std::string)field_name + " not found");
      }
      if (input_stream.current_puncuator != '}')
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
             is_std_optional<remove_cvref_t<decltype(std::get<i>(args))>>();
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

         constexpr bool is_opt = is_std_optional_v<remove_cvref_t<decltype(std::get<i>(args))>>;
         if (input_stream.current_value != std::data(arg_names)[i])
            return gql_parse_args<i + 1>(args, filled, found, input_stream, error, arg_names);
         input_stream.skip();
         if (input_stream.current_puncuator != ':')
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
      if (input_stream.current_puncuator != '{')
         return true;
      input_stream.skip();
      while (true)
      {
         if (input_stream.current_type == gql_stream::eof)
            return error("expected }");
         else if (input_stream.current_puncuator == '{')
         {
            if (!gql_skip_selection_set(input_stream, error))
               return false;
         }
         else if (input_stream.current_puncuator == '}')
         {
            input_stream.skip();
            return true;
         }
         else
            input_stream.skip();
      }
   }

   template <typename T, typename OS, typename E>
   auto gql_query(const T& value, gql_stream& input_stream, OS& output_stream, const E& error)
       -> std::enable_if_t<std::is_arithmetic_v<T> || std::is_same_v<T, std::string>, bool>
   {
      to_json(value, output_stream);
      return true;
   }

   template <typename T, typename OS, typename E>
   auto gql_query(const T& value, gql_stream& input_stream, OS& output_stream, const E& error)
       -> std::enable_if_t<is_std_optional<T>() || std::is_pointer<T>() || is_std_unique_ptr<T>(),
                           bool>
   {
      if (value)
         return gql_query(*value, input_stream, output_stream, error);
      write_str("null", output_stream);
      return gql_skip_selection_set(input_stream, error);
   }

   template <typename T, typename OS, typename E>
   auto gql_query(const T& value, gql_stream& input_stream, OS& output_stream, const E& error)
       -> std::enable_if_t<is_std_reference_wrapper_v<T>, bool>
   {
      return gql_query(value.get(), input_stream, output_stream, error);
   }

   template <typename T, typename OS, typename E>
   auto gql_query(const T& value, gql_stream& input_stream, OS& output_stream, const E& error)
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
         if (!gql_query(v, copy, output_stream, error))
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

   template <typename Raw, typename MPtr, typename OS, typename E>
   bool gql_query_fn(const Raw&                   value,
                     std::span<const char* const> argNames,
                     MPtr                         mptr,
                     gql_stream&                  input_stream,
                     OS&                          output_stream,
                     const E&                     error)
   {
      using args_tuple              = decltype(args_as_tuple(mptr));
      static constexpr int num_args = std::tuple_size_v<args_tuple>;
      using ReturnType              = std::remove_cvref_t<typename MemberPtrType<MPtr>::ReturnType>;
      if constexpr (num_args == 0 && gql_callable_args((ReturnType*)nullptr))
      {
         return gql_query_fn((value.*mptr)(), *gql_callable_args((ReturnType*)nullptr),
                             &ReturnType::operator(), input_stream, output_stream, error);
      }
      else
      {
         args_tuple args;
         bool       filled[num_args] = {};
         if (input_stream.current_puncuator == '(')
         {
            input_stream.skip();
            if (input_stream.current_puncuator == ')')
               return error("empty arg list");
            while (input_stream.current_type == gql_stream::name)
            {
               bool found = false;
               if (!gql_parse_args<0>(args, filled, found, input_stream, error, argNames))
                  return false;
               if (!found)
                  return error("unknown arg '" + (std::string)input_stream.current_value + "'");
            }
            if (input_stream.current_puncuator != ')')
               return error("expected )");
            input_stream.skip();
         }
         gql_mark_optional<0>(args, filled);
         if constexpr (num_args > 0)
            for (int i = 0; i < num_args; ++i)
               if (!filled[i])
                  return error("function missing required arg '" +
                               std::string(std::data(argNames)[i]) + "'");
         auto result =
             std::apply([&](auto&&... args) { return (value.*mptr)(std::move(args)...); }, args);
         if (!gql_query(result, input_stream, output_stream, error))
            return false;
         return true;
      }
   }  // gql_query_fn

   template <typename Raw, typename OS, typename E>
   auto gql_query(const Raw& value, gql_stream& input_stream, OS& output_stream, const E& error)
       -> std::enable_if_t<reflect<Raw>::is_struct and not has_get_gql_name<Raw>::value, bool>
   {
      using T = remove_cvref_t<Raw>;
      if (input_stream.current_puncuator != '{')
         return error("expected {");
      input_stream.skip();
      bool first = true;
      output_stream.write('{');
      while (input_stream.current_type == gql_stream::name)
      {
         bool found      = false;
         bool ok         = true;
         auto alias      = input_stream.current_value;
         auto field_name = alias;
         input_stream.skip();
         if (input_stream.current_puncuator == ':')
         {
            input_stream.skip();
            if (input_stream.current_type != gql_stream::name)
               return error("expected name after :");
            field_name = input_stream.current_value;
            input_stream.skip();
         }

         reflect<T>::get_by_name(
             hash_name(field_name),
             [&](const meta& m, auto member)
             {
                using MemPtr = MemberPtrType<decltype(member(std::declval<T*>()))>;
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
                to_json(alias, output_stream);
                write_colon(output_stream);

                if constexpr (!MemPtr::isFunction)
                {
                   found = true;
                   ok &= gql_query(value.*member(&value), input_stream, output_stream, error);
                }
                else if constexpr (MemPtr::isConstFunction)
                {
                   found = true;
                   ok &= gql_query_fn(value, m.param_names, member(&value), input_stream,
                                      output_stream, error);
                }
             });

         if (!ok)
            return false;
         if (!found)
            return error((std::string)field_name + " not found");
      }
      if (input_stream.current_puncuator != '}')
         return error("expected }");
      input_stream.skip();
      if (!first)
      {
         decrease_indent(output_stream);
         write_newline(output_stream);
      }
      output_stream.write('}');
      return true;
   }

   template <typename T, typename OS, typename E>
   bool gql_query_root(const T& value, gql_stream& input_stream, OS& output_stream, const E& error)
   {
      if (input_stream.current_type == gql_stream::name)
      {
         if (input_stream.current_value == "query")
         {
            input_stream.skip();
            if (input_stream.current_type == gql_stream::name)
               input_stream.skip();
            if (input_stream.current_puncuator == '(')
               return error("variables not supported");
            if (input_stream.current_puncuator == '@')
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
      if (!gql_query(value, input_stream, output_stream, error))
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
   std::string gql_query(const T& value, std::string_view query, std::string_view variables)
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
         ok = gql_query_root(value, input_stream, output_stream,
                             [&](const auto& e)
                             {
                                error = e;
                                return false;
                             });
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
   std::string format_gql_query(const T& value, std::string_view query)
   {
      return gql_query<pretty_stream<string_stream>>(value, query);
   }

   template <typename T, typename E>
   auto gql_parse_arg(T& arg, gql_stream& input_stream, const E& error)
       -> std::enable_if_t<use_json_string_for_gql((T*)nullptr), bool>
   {
      if (input_stream.current_type == gql_stream::string)
      {
         from_string(arg, input_stream.current_value);
         // TODO: prevent abort
         //arg = psio::convert_from_string<T>(input_stream.current_value);
         input_stream.skip();
         return true;
      }
      return error("expected String");
   }
}  // namespace psio

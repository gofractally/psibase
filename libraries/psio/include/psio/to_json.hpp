#pragma once

#include <psio/fpconv.h>
#include <cmath>
#include <limits>
#include <optional>
#include <psio/reflect.hpp>
#include <psio/stream.hpp>
#include <psio/tuple.hpp>
#include <psio/untagged.hpp>
#include <type_traits>
#include <variant>

#include <rapidjson/encodings.h>

namespace psio
{

   inline constexpr char hex_digits[] = "0123456789ABCDEF";

   // Adaptors for rapidjson
   struct stream_adaptor
   {
      stream_adaptor(const char* src, int sz)
      {
         int chars = std::min(sz, 4);
         memcpy(buf, src, chars);
         memset(buf + chars, 0, 4 - chars);
      }
      void Put(char ch) {}
      char Take() { return buf[idx++]; }
      char buf[4];
      int  idx = 0;
   };

   // Replaces any invalid utf-8 bytes with ?
   template <typename S>
   void to_json(std::string_view sv, S& stream)
   {
      stream.write('"');
      auto begin = sv.begin();
      auto end   = sv.end();
      while (begin != end)
      {
         auto pos = begin;
         while (pos != end && *pos != '"' && *pos != '\\' && (unsigned char)(*pos) >= 32 &&
                *pos != 127)
            ++pos;
         while (begin != pos)
         {
            stream_adaptor s2(begin, static_cast<std::size_t>(pos - begin));
            if (rapidjson::UTF8<>::Validate(s2, s2))
            {
               stream.write(begin, s2.idx);
               begin += s2.idx;
            }
            else
            {
               ++begin;
               stream.write('?');
            }
         }
         if (begin != end)
         {
            if (*begin == '"')
            {
               stream.write("\\\"", 2);
            }
            else if (*begin == '\\')
            {
               stream.write("\\\\", 2);
            }
            else if (*begin == '\b')
            {
               stream.write("\\b", 2);
            }
            else if (*begin == '\f')
            {
               stream.write("\\f", 2);
            }
            else if (*begin == '\n')
            {
               stream.write("\\n", 2);
            }
            else if (*begin == '\r')
            {
               stream.write("\\r", 2);
            }
            else if (*begin == '\t')
            {
               stream.write("\\t", 2);
            }
            else
            {
               stream.write("\\u00", 4);
               stream.write(hex_digits[(unsigned char)(*begin) >> 4]);
               stream.write(hex_digits[(unsigned char)(*begin) & 15]);
            }
            ++begin;
         }
      }
      stream.write('"');
   }

   template <typename S>
   void to_json(const std::string& s, S& stream)
   {
      return to_json(std::string_view{s}, stream);
   }

   template <typename S>
   void to_json(const char* s, S& stream)
   {
      return to_json(std::string_view{s}, stream);
   }

   template <typename S>
   void to_json(bool value, S& stream)
   {
      if (value)
         return stream.write("true", 4);
      else
         return stream.write("false", 5);
   }

   template <typename T, typename S>
   void int_to_json(T value, S& stream)
   {
      auto                                               uvalue = std::make_unsigned_t<T>(value);
      small_buffer<std::numeric_limits<T>::digits10 + 4> b;
      bool                                               neg = value < 0;
      if (neg)
         uvalue = -uvalue;
      if (sizeof(T) > 4)
         *b.pos++ = '"';
      do
      {
         *b.pos++ = '0' + (uvalue % 10);
         uvalue /= 10;
      } while (uvalue);
      if (neg)
         *b.pos++ = '-';
      if (sizeof(T) > 4)
         *b.pos++ = '"';
      b.reverse();
      return stream.write(b.data, b.pos - b.data);
   }

   template <typename S>
   void fp_to_json(double value, S& stream)
   {
      // fpconv is not quite consistent with javascript for nans and infinities
      if (value == std::numeric_limits<double>::infinity())
      {
         return stream.write("\"Infinity\"", 10);
      }
      else if (value == -std::numeric_limits<double>::infinity())
      {
         return stream.write("\"-Infinity\"", 11);
      }
      else if (std::isnan(value))
      {
         return stream.write("\"NaN\"", 5);
      }
      small_buffer<24> b;  // fpconv_dtoa generates at most 24 characters
      int              n = fpconv_dtoa(value, b.pos);
      if (n <= 0)
         abort_error(stream_error::float_error);
      b.pos += n;
      stream.write(b.data, b.pos - b.data);
   }

   // clang-format off
template <typename S> void to_json(std::byte value, S& stream)          { return int_to_json(static_cast<unsigned char>(value), stream); }
template <typename S> void to_json(unsigned char value, S& stream)      { return int_to_json(value, stream); }
template <typename S> void to_json(uint16_t value, S& stream)           { return int_to_json(value, stream); }
template <typename S> void to_json(uint32_t value, S& stream)           { return int_to_json(value, stream); }
template <typename S> void to_json(uint64_t value, S& stream)           { return int_to_json(value, stream); }
//template <typename S> void to_json(unsigned long value, S& stream)      { return int_to_json(value, stream); }
template <typename S> void to_json(unsigned __int128 value, S& stream)  { return int_to_json(value, stream); }
template <typename S> void to_json(char value, S& stream)               { return int_to_json(value, stream); }
template <typename S> void to_json(signed char value, S& stream)        { return int_to_json(value, stream); }
template <typename S> void to_json(int16_t value, S& stream)            { return int_to_json(value, stream); }
template <typename S> void to_json(int32_t value, S& stream)            { return int_to_json(value, stream); }
template <typename S> void to_json(int64_t value, S& stream)            { return int_to_json(value, stream); }
template <typename S> void to_json(__int128 value, S& stream)           { return int_to_json(value, stream); }
template <typename S> void to_json(double value, S& stream)             { return fp_to_json(value, stream); }
template <typename S> void to_json(float value, S& stream)              { return fp_to_json(value, stream); }

   // clang-format on

   template <typename T, typename S>
   void to_json(const std::vector<T>& obj, S& stream)
   {
      stream.write('[');
      bool first = true;
      for (auto& v : obj)
      {
         if (first)
         {
            increase_indent(stream);
         }
         else
         {
            stream.write(',');
         }
         write_newline(stream);
         first = false;
         to_json(v, stream);
      }
      if (!first)
      {
         decrease_indent(stream);
         write_newline(stream);
      }
      stream.write(']');
   }

   template <typename T, typename S>
   void to_json(const std::optional<T>& obj, S& stream)
   {
      if (obj)
      {
         return to_json(*obj, stream);
      }
      else
      {
         return stream.write("null", 4);
      }
   }

   template <typename... T, typename S>
   void to_json(const std::variant<T...>& obj, S& stream)
   {
      std::visit(
          [&](const auto& t)
          {
             using Alternative = std::remove_cvref_t<decltype(t)>;
             if constexpr (psio_is_untagged(static_cast<const Alternative*>(nullptr)))
             {
                to_json(t, stream);
             }
             else
             {
                stream.write('{');
                increase_indent(stream);
                write_newline(stream);
                to_json(get_type_name<Alternative>(), stream);
                write_colon(stream);
                to_json(t, stream);
                decrease_indent(stream);
                write_newline(stream);
                stream.write('}');
             }
          },
          obj);
   }

   template <typename... T, typename S>
   void to_json(const std::tuple<T...>& obj, S& stream)
   {
      stream.write('[');
      if (sizeof...(T) == 0)
         return stream.write(']');
      increase_indent(stream);

      psio::tuple_for_each(obj,
                           [&](int idx, auto& item)
                           {
                              write_newline(stream);
                              if (idx)
                              {
                                 stream.write(',');
                              }
                              to_json(item, stream);
                           });
      decrease_indent(stream);
      write_newline(stream);
      return stream.write(']');
   }

   namespace detail
   {
      template <typename S>
      struct add_field_fn
      {
         template <typename T>
         void operator()(const T& member)
         {
            //if constexpr (is_std_optional<T>::value)
            //{
            //   if (!member)
            //      return;
            //}
            if (first)
            {
               increase_indent(stream);
               first = false;
            }
            else
            {
               stream.write(',');
            }
            write_newline(stream);
            to_json(field_names[i], stream);
            write_colon(stream);
            to_json(member, stream);
            ++i;
         }
         const char* const* field_names;
         S&                 stream;
         std::size_t        i     = 0;
         bool               first = true;
      };
   }  // namespace detail

   template <typename T, typename S>
   void to_json(const T& t, S& stream)
   {
      stream.write('{');
      bool first =
          psio::for_each_member(&t, (typename reflect<T>::data_members*)nullptr,
                                detail::add_field_fn<S>{reflect<T>::data_member_names, stream})
              .first;
      if (!first)
      {
         decrease_indent(stream);
         write_newline(stream);
      }
      stream.write('}');
   }

   template <typename S>
   void to_json_hex(const char* data, size_t size, S& stream)
   {
      stream.write('"');
      for (size_t i = 0; i < size; ++i)
      {
         unsigned char byte = data[i];
         stream.write(hex_digits[byte >> 4]);
         stream.write(hex_digits[byte & 15]);
      }
      stream.write('"');
   }

   template <typename S>
   void to_json(const input_stream& data, S& stream)
   {
      to_json_hex(data.pos, data.end - data.pos, stream);
   }

   template <typename S>
   void to_json(const std::span<char>& obj, S& stream)
   {
      to_json_hex(obj.data(), obj.size(), stream);
   }

   template <typename S>
   void to_json(const std::span<const char>& obj, S& stream)
   {
      to_json_hex(obj.data(), obj.size(), stream);
   }

   template <typename S>
   void to_json(const std::vector<char>& obj, S& stream)
   {
      to_json_hex(obj.data(), obj.size(), stream);
   }

   template <typename S>
   void to_json(const std::vector<unsigned char>& v, S& stream)
   {
      to_json_hex(reinterpret_cast<const char*>(v.data()), v.size(), stream);
   }

   template <size_t N, typename S>
   void to_json(const std::array<unsigned char, N>& obj, S& stream)
   {
      to_json_hex(reinterpret_cast<const char*>(obj.data()), obj.size(), stream);
   }

   template <size_t N, typename S>
   void to_json(const std::array<char, N>& obj, S& stream)
   {
      to_json_hex(reinterpret_cast<const char*>(obj.data()), obj.size(), stream);
   }

   template <typename T, std::size_t N, typename S>
   void to_json(const std::array<T, N>& obj, S& stream)
   {
      stream.write('[');
      bool first = true;
      for (auto& v : obj)
      {
         if (first)
         {
            increase_indent(stream);
         }
         else
         {
            stream.write(',');
         }
         write_newline(stream);
         first = false;
         to_json(v, stream);
      }
      if (!first)
      {
         decrease_indent(stream);
         write_newline(stream);
      }
      stream.write(']');
   }

   template <typename T>
   std::string convert_to_json(const T& t)
   {
      size_stream ss;
      to_json(t, ss);

      std::string      result(ss.size, 0);
      fixed_buf_stream fbs(result.data(), result.size());
      to_json(t, fbs);

      if (fbs.pos == fbs.end)
         return result;
      else
         abort_error(stream_error::underrun);
   }

   template <typename T>
   std::string format_json(const T& t)
   {
      pretty_stream<size_stream> ss;
      to_json(t, ss);
      std::string                     result(ss.size, 0);
      pretty_stream<fixed_buf_stream> fbs(result.data(), result.size());
      to_json(t, fbs);
      if (fbs.pos != fbs.end)
         abort_error(stream_error::underrun);
      return result;
   }

}  // namespace psio

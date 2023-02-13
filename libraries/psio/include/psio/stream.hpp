#pragma once

#include <string.h>
#include <algorithm>
#include <psio/check.hpp>
#include <span>
#include <string>
#include <string_view>
#include <system_error>
#include <type_traits>
#include <vector>

namespace psio
{
   enum class stream_error
   {
      no_error,
      overrun,
      underrun,
      doubleread,
      float_error,
      varuint_too_big,
      invalid_varuint_encoding,
      bad_variant_index,
      array_size_mismatch,
      name_too_long,
      json_writer_error,
      invalid_frac_encoding,
      empty_vec_used_offset,
   };  // stream_error

   constexpr inline std::string_view error_to_str(stream_error e)
   {
      switch (e)
      {
            // clang-format off
         case stream_error::no_error:                 return "No error";
         case stream_error::overrun:                  return "Stream overrun";
         case stream_error::underrun:                 return "Stream underrun";
         case stream_error::doubleread:               return "Double-read Error";
         case stream_error::float_error:              return "Float error";
         case stream_error::varuint_too_big:          return "Varuint too big";
         case stream_error::invalid_varuint_encoding: return "Invalid varuint encoding";
         case stream_error::bad_variant_index:        return "Bad variant index";
         case stream_error::array_size_mismatch:      return "T[] size and unpacked size don't match";
         case stream_error::name_too_long:            return "String is too long to be a valid name";
         case stream_error::json_writer_error:        return "Error writing json";
         case stream_error::invalid_frac_encoding:    return "Invalid fracpack encoding";
         case stream_error::empty_vec_used_offset:    return "empty_vec_used_offset";
            // clang-format on

         default:
            return "unknown";
      }
   }

   template <typename T>
   constexpr bool has_bitwise_serialization()
   {
      if constexpr (std::is_arithmetic_v<T>)
      {
         return true;
      }
      else if constexpr (std::is_enum_v<T>)
      {
         static_assert(!std::is_convertible_v<T, std::underlying_type_t<T>>,
                       "Serializing unscoped enum");
         return true;
      }
      else
      {
         return false;
      }
   }

   template <int max_size>
   struct small_buffer
   {
      char  data[max_size];
      char* pos{data};

      void reverse() { std::reverse(data, pos); }
   };

   struct string_stream
   {
      std::string& data;
      string_stream(std::string& data) : data(data) {}

      void write(char ch) { data += ch; }

      void write(const void* src, size_t size)
      {
         auto s = reinterpret_cast<const char*>(src);
         data.insert(data.end(), s, s + size);
      }

      template <typename T>
      void write_raw(const T& v)
      {
         write(&v, sizeof(v));
      }
   };

   struct vector_stream
   {
      std::vector<char>& data;
      vector_stream(std::vector<char>& data) : data(data) {}

      void about_to_write(size_t amount) { data.reserve(data.size() + amount); }

      void write(char ch) { data.push_back(ch); }

      void write(const void* src, size_t size)
      {
         auto s = reinterpret_cast<const char*>(src);
         data.insert(data.end(), s, s + size);
      }

      template <typename T>
      void write_raw(const T& v)
      {
         write(&v, sizeof(v));
      }

      template <typename T>
      void rewrite_raw(size_t offset, const T& v)
      {
         memcpy(data.data() + offset, &v, sizeof(v));
      }

      size_t written() const { return data.size(); }
   };

   struct fixed_buf_stream
   {
      char* begin;
      char* pos;
      char* end;

      fixed_buf_stream(char* pos, size_t size) : begin(pos), pos{pos}, end{pos + size} {}

      void about_to_write(size_t amount) {}

      void write(char ch)
      {
         if (pos >= end)
            abort_error(stream_error::overrun);
         *pos++ = ch;
      }

      void write(const void* src, size_t size)
      {
         if (pos + size > end)
            abort_error(stream_error::overrun);
         memcpy(pos, src, size);
         pos += size;
      }

      template <typename T>
      void write_raw(const T& v)
      {
         write(&v, sizeof(v));
      }

      template <typename T>
      void rewrite_raw(size_t offset, const T& v)
      {
         memcpy(begin + offset, &v, sizeof(v));
      }

      void skip(int32_t s)
      {
         if ((pos + s > end) or (pos + s < begin))
            abort_error(stream_error::overrun);
         pos += s;
      }

      size_t remaining() const { return end - pos; }
      size_t consumed() const { return pos - begin; }
      size_t written() const { return pos - begin; }
   };

   /**
    * Does not bounds checking, assuming packsize was done first.
    */
   struct fast_buf_stream
   {
      char* begin;
      char* pos;
      char* end;

      void about_to_write(size_t amount) {}

      fast_buf_stream(char* pos, size_t size) : begin(pos), pos{pos}, end{pos + size} {}

      void write(char ch) { *pos++ = ch; }

      void write(const void* src, size_t size)
      {
         memcpy(pos, src, size);
         pos += size;
      }

      template <typename T>
      void write_raw(const T& v)
      {
         write(&v, sizeof(v));
      }

      template <typename T>
      void rewrite_raw(size_t offset, const T& v)
      {
         memcpy(begin + offset, &v, sizeof(v));
      }

      void skip(int32_t s) { pos += s; }

      size_t remaining() const { return end - pos; }
      size_t consumed() const { return pos - begin; }
      size_t written() const { return pos - begin; }
   };

   struct size_stream
   {
      size_t size = 0;

      void about_to_write(size_t amount) {}

      void write(char ch) { ++size; }
      void write(const void* src, size_t size) { this->size += size; }

      template <typename T>
      void write_raw(const T& v)
      {
         size += sizeof(v);
      }

      template <typename T>
      void rewrite_raw(size_t offset, const T& v)
      {
      }

      void   skip(int32_t s) { size += s; }
      size_t written() const { return size; }
   };

   template <typename S>
   void increase_indent(S&)
   {
   }

   template <typename S>
   void decrease_indent(S&)
   {
   }

   template <typename S>
   void write_colon(S& s)
   {
      s.write(':');
   }

   template <typename S>
   void write_newline(S&)
   {
   }

   template <typename Base>
   struct pretty_stream : Base
   {
      using Base::Base;
      int               indent_size = 4;
      std::vector<char> current_indent;
   };

   template <typename S>
   void increase_indent(pretty_stream<S>& s)
   {
      s.current_indent.resize((int)s.current_indent.size() + s.indent_size, ' ');
   }

   template <typename S>
   void decrease_indent(pretty_stream<S>& s)
   {
      if ((int)s.current_indent.size() < s.indent_size)
         abort_error(stream_error::overrun);
      s.current_indent.resize((int)s.current_indent.size() - s.indent_size);
   }

   template <typename S>
   void write_colon(pretty_stream<S>& s)
   {
      s.write(": ", 2);
   }

   template <typename S>
   void write_newline(pretty_stream<S>& s)
   {
      s.write('\n');
      s.write(s.current_indent.data(), (int)s.current_indent.size());
   }

   struct input_stream
   {
      const char* pos;
      const char* end;

      constexpr input_stream() : pos{nullptr}, end{nullptr} {}
      constexpr input_stream(const char* pos, size_t size) : pos{pos}, end{pos + size} {}
      constexpr input_stream(const char* pos, const char* end) : pos{pos}, end{end}
      {
         if (end < pos)
            abort_error(stream_error::overrun);
      }
      input_stream(const std::vector<char>& v) : pos{v.data()}, end{v.data() + v.size()} {}
      constexpr input_stream(std::string_view v) : pos{v.data()}, end{v.data() + v.size()} {}
      constexpr input_stream(std::span<const char> v) : pos{v.data()}, end{v.data() + v.size()} {}
      constexpr input_stream(const input_stream&) = default;

      input_stream& operator=(const input_stream&) = default;

      std::string_view  string_view() const { return {pos, remaining()}; }
      std::vector<char> vector() const { return {pos, pos + remaining()}; }

      size_t remaining() const { return end - pos; }

      void check_available(size_t size) const
      {
         if (size > size_t(end - pos))
            abort_error(stream_error::overrun);
      }

      void read(void* dest, size_t size)
      {
         if (size > size_t(end - pos))
            abort_error(stream_error::overrun);
         memcpy(dest, pos, size);
         pos += size;
      }

      template <typename T>
      void read_raw(T& dest)
      {
         read(&dest, sizeof(dest));
      }

      void skip(size_t size)
      {
         if (size > size_t(end - pos))
            abort_error(stream_error::overrun);
         pos += size;
      }

      void read_reuse_storage(const char*& result, size_t size)
      {
         if (size > size_t(end - pos))
            abort_error(stream_error::overrun);
         result = pos;
         pos += size;
      }
   };

   struct check_input_stream
   {
      const char* begin;
      const char* pos;
      const char* end;
      size_t      total_read = 0;
      size_t      size       = 0;
      void        add_total_read(uint32_t v)
      {
         total_read += v;
         if (size < get_total_read())
         {
            abort_error(stream_error::doubleread);
         }
      }
      size_t get_total_read() const { return total_read + (pos - begin); }

      constexpr check_input_stream() : begin{nullptr}, pos{nullptr}, end{nullptr} {}
      constexpr check_input_stream(const char* pos, size_t size)
          : begin(pos), pos{pos}, end{pos + size}, size(size)
      {
      }
      constexpr check_input_stream(const char* pos, const char* end)
          : begin(pos), pos{pos}, end{end}
      {
         if (end < pos)
            abort_error(stream_error::overrun);
      }
      check_input_stream(const std::vector<char>& v)
          : begin(v.data()), pos{v.data()}, end{v.data() + v.size()}
      {
      }
      constexpr check_input_stream(std::string_view v)
          : begin(v.data()), pos{v.data()}, end{v.data() + v.size()}
      {
      }
      constexpr check_input_stream(const check_input_stream&) = default;

      check_input_stream& operator=(const check_input_stream&) = default;

      size_t remaining() const { return end - pos; }

      void check_available(size_t size) const
      {
         if (size > size_t(end - pos))
            abort_error(stream_error::overrun);
      }

      void read(void* dest, size_t size)
      {
         if (size > size_t(end - pos))
            abort_error(stream_error::overrun);
         memcpy(dest, pos, size);
         pos += size;
      }

      template <typename T>
      void read_raw(T& dest)
      {
         read(&dest, sizeof(dest));
      }

      void skip(size_t size)
      {
         if (size > size_t(end - pos))
            abort_error(stream_error::overrun);
         pos += size;
      }

      void read_reuse_storage(const char*& result, size_t size)
      {
         if (size > size_t(end - pos))
            abort_error(stream_error::overrun);
         result = pos;
         pos += size;
      }
   };

   template <typename S>
   void write_str(std::string_view str, S& stream)
   {
      stream.write(str.data(), str.size());
   }
}  // namespace psio

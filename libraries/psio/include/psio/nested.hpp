#pragma once

#include <psio/fracpack.hpp>
#include <psio/from_json.hpp>
#include <psio/to_hex.hpp>
#include <psio/view.hpp>

namespace psio
{
   template <typename Stream>
   struct hex_output_stream
   {
      Stream&     stream;
      std::size_t base;

      hex_output_stream(Stream& stream) : stream(stream), base(stream.written()) {}

      void about_to_write(std::size_t amount) { stream.about_to_write(amount * 2); }

      void write(char ch)
      {
         auto nibble = [](std::uint8_t i) -> char
         {
            if (i <= 9)
               return '0' + i;
            else
               return 'A' + i - 10;
         };
         stream.write(nibble(((std::uint8_t)ch) >> 4));
         stream.write(nibble(((std::uint8_t)ch) & 0xf));
      }

      void write(const void* src, size_t size)
      {
         auto s = reinterpret_cast<const char*>(src);
         for (char ch : std::span{s, size})
         {
            write(ch);
         }
      }

      template <typename T>
      void write_raw(const T& v)
      {
         write(&v, sizeof(v));
      }

      template <typename T>
      void rewrite_raw(size_t offset, const T& v)
      {
         char                  buf[sizeof(v) * 2];
         std::span<const char> in{reinterpret_cast<const char*>(&v), sizeof(v)};
         psio::hex(in.begin(), in.end(), buf);
         stream.rewrite_raw(base + offset * 2, buf);
      }

      size_t written() const { return (stream.written() - base) / 2; }
   };

   /**
    * This type is serialized as a vector<char> holding the packed value.
    */
   template <typename T>
   struct nested
   {
      using value_type = std::remove_cvref_t<T>;
      T           value;
      friend bool operator==(const nested&, const nested&) = default;
   };

   template <typename T, typename Stream>
   void to_json(const nested<T>& obj, Stream& stream)
   {
      stream.write('"');
      hex_output_stream hex(stream);
      to_frac(obj.value, hex);
      stream.write('"');
   }

   template <typename T, typename Stream>
   void from_json(nested<T>& obj, Stream& stream)
   {
      std::vector<char> tmp;
      from_json(tmp, stream);
      from_frac(obj.value, tmp);
   }

   // Handles any type that backs to a byte vector
   //
   // Derived must provide
   // - pack_contents
   // - unpack_contents
   // - is_empty_container
   template <typename T, typename Derived>
   struct is_packable_nested_impl : base_packable_impl<T, Derived>
   {
      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = true;

      template <typename S>
      static void pack(const T& value, S& stream)
      {
         std::uint32_t size = 0;
         auto          pos  = stream.written();
         stream.write_raw(size);
         Derived::pack_contents(value, stream);
         auto end = stream.written();
         size     = end - (pos + 4);
         stream.rewrite_raw(pos, size);
      }

      static bool is_empty_container(const char* src, uint32_t pos, uint32_t end_pos)
      {
         uint32_t fixed_size;
         if (!unpack_numeric<true>(&fixed_size, src, pos, end_pos))
            return false;
         return fixed_size == 0;
      }

      template <bool Verify>
      static bool clear_container(T* value)
      {
         // We don't need to propagate these up, because an empty object
         // definitely does not contain unknown data
         bool          has_unknown = false;
         bool          known_end;
         std::uint32_t pos = 0;
         if (!Derived::template unpack_contents<true, Verify>(value, has_unknown, known_end,
                                                              value->data(), pos, 0))
            return false;
         return true;
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(T*          value,
                                       bool&       has_unknown,
                                       bool&       known_end,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         uint32_t size = 0;
         if (!unpack_numeric<Verify>(&size, src, pos, end_pos))
            return false;
         if constexpr (Verify)
         {
            known_end = true;
            if (size > end_pos - pos)
               return false;
         }
         bool          inner_known_end;
         std::uint32_t inner_pos = pos;
         if (!Derived::template unpack_contents<Unpack, Verify>(value, has_unknown, inner_known_end,
                                                                src, inner_pos, pos + size))
            return false;
         if constexpr (Verify)
         {
            if (inner_known_end && inner_pos != pos + size)
               return false;
            known_end = true;
         }
         pos += size;
         return true;
      }
   };

   template <typename T>
   struct is_packable<nested<T>> : is_packable_nested_impl<nested<T>, is_packable<nested<T>>>
   {
      static bool is_empty_container(const nested<T>&)
      {
         using is_p = is_packable<std::remove_cvref_t<T>>;
         return !is_p::is_variable_size && is_p::fixed_size == 0;
      }
      template <typename S>
      static void pack_contents(const nested<T>& value, S& stream)
      {
         is_packable<std::remove_cvref_t<T>>::pack(value.value, stream);
      }
      template <bool Unpack, bool Verify>
      static bool unpack_contents(nested<T>*  value,
                                  bool&       has_unknown,
                                  bool&       known_end,
                                  const char* src,
                                  uint32_t&   pos,
                                  uint32_t    end_pos)
      {
         return is_packable<std::remove_cvref_t<T>>::template unpack<Unpack, Verify>(
             Unpack ? &value->value : nullptr, has_unknown, known_end, src, pos, end_pos);
      }
   };

   template <typename T>
   struct view_interface<nested<T>> : view_base<nested<T>>
   {
      auto value() { return view<T>(prevalidated{this->data + 4}); }
   };

   template <typename T>
   struct view_interface<const nested<T>> : view_base<const nested<T>>
   {
      auto value() { return view<const T>(prevalidated{this->data + 4}); }
   };

   template <typename T>
   struct nested_json
   {
      T value;
   };

   template <typename T, typename Stream>
   void to_json(const nested_json<T>& obj, Stream& stream)
   {
      stream.write('"');
      hex_output_stream hex(stream);
      to_json(obj.value, hex);
      stream.write('"');
   }

   template <typename T, typename Stream>
   void from_json(nested_json<T>& obj, Stream& stream)
   {
      std::vector<char> tmp;
      from_json(tmp, stream);
      tmp.push_back(0);
      Stream inner{tmp.data()};
      from_json(obj.value, inner);
   }

   template <typename T>
   struct is_packable<nested_json<T>>
       : is_packable_nested_impl<nested_json<T>, is_packable<nested_json<T>>>
   {
      static bool is_empty_container(const nested_json<T>&)
      {
         // The empty string is not valid JSON
         return false;
      }
      template <typename S>
      static void pack_contents(const nested_json<T>& value, S& stream)
      {
         to_json(value.value, stream);
      }
      template <bool Unpack, bool Verify>
      static bool unpack_contents(nested<T>*  value,
                                  bool&       has_unknown,
                                  bool&       known_end,
                                  const char* src,
                                  uint32_t&   pos,
                                  uint32_t    end_pos)
      {
         std::vector<char> contents;
         contents.reserve(end_pos - pos + 1);
         contents.insert(contents.end(), src + pos, src + end_pos);
         contents.push_back(0);
         if constexpr (Unpack)
         {
            json_token_stream stream(contents.data());
            from_json(value->value, stream);
         }
         return true;
      }
   };

   template <typename T>
   constexpr bool packable_as_impl<nested<T>, std::vector<char>> = true;
   template <typename T, typename U>
   constexpr bool packable_as_impl<nested<T>, nested<U>> = PackableAs<T, U>;

   template <typename T>
   constexpr bool packable_as_impl<nested_json<T>, std::vector<char>> = true;
   template <typename T>
   constexpr bool packable_as_impl<nested_json<T>, std::string> = true;
   template <typename T, typename U>
   constexpr bool packable_as_impl<nested_json<T>, nested_json<U>> = PackableAs<T, U>;

}  // namespace psio

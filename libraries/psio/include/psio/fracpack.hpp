// TODO: The interaction between checking for no extra data (no gaps)
//       and the possible presence of unknown fields and variant tags
//       has some unsolved border cases. It might be best to only check
//       for gaps when in a mode which prohibits unknown fields and skip
//       checking for gaps when in a mode which allows unknown fields.

#pragma once

#include <psio/reflect.hpp>
#include <psio/stream.hpp>

#include <cassert>
#include <cstring>

namespace psio
{
   // If a type T supports the expressions `clio_unwrap_packable(T&)`,
   // which returns a `T2&`, and `clio_unwrap_packable(const T&)`, which
   // returns `const T2&`, then packing or unpacking T packs or unpacks
   // the returned reference instead.
   template <typename T>
   concept PackableWrapper = requires(T& x, const T& cx) {
                                clio_unwrap_packable(x);
                                clio_unwrap_packable(cx);
                             };

   template <typename T, bool Reflected>
   struct is_packable_reflected;

   template <typename T>
   struct is_packable_reflected<T, false> : std::bool_constant<false>
   {
   };

   template <typename T>
   struct is_packable_reflected<T, true>;

   template <typename T>
   struct is_packable : is_packable_reflected<T, Reflected<T>>
   {
   };

   // Checking Reflected here is necessary to handle recursive structures
   // because is_packable<T> might already be on the instantiation stack
   template <typename T>
   concept Packable = Reflected<T> || is_packable<T>::value;

   template <typename T>
   concept PackableNumeric =            //
       std::is_same_v<T, std::byte> ||  //
       std::is_same_v<T, char> ||       //
       std::is_same_v<T, uint8_t> ||    //
       std::is_same_v<T, uint16_t> ||   //
       std::is_same_v<T, uint32_t> ||   //
       std::is_same_v<T, uint64_t> ||   //
       std::is_same_v<T, int8_t> ||     //
       std::is_same_v<T, int16_t> ||    //
       std::is_same_v<T, int32_t> ||    //
       std::is_same_v<T, int64_t> ||    //
       std::is_same_v<T, float> ||      //
       std::is_same_v<T, double>;

   template <bool Verify, PackableNumeric T>
   [[nodiscard]] bool unpack_numeric(T* value, const char* src, uint32_t& pos, uint32_t end_pos);

   template <typename T>
   struct is_packable_memcpy : std::bool_constant<false>
   {
   };

   template <typename T>
   concept PackableMemcpy = is_packable_memcpy<T>::value;

   template <PackableNumeric T>
   struct is_packable_memcpy<T> : std::bool_constant<true>
   {
   };

   template <PackableMemcpy T, std::size_t N>
   struct is_packable_memcpy<std::array<T, N>> : std::bool_constant<true>
   {
      static_assert(sizeof(std::array<T, N>) == N * sizeof(T));
   };

   template <>
   struct is_packable<std::string>;

   template <>
   struct is_packable<std::string_view>;

   template <PackableMemcpy T>
   struct is_packable<std::span<T>>;

   template <Packable T>
   struct is_packable<std::vector<T>>;

   template <Packable T, std::size_t N>
      requires(!is_packable_memcpy<T>::value)
   struct is_packable<std::array<T, N>>;

   template <Packable T>
   struct is_packable<std::optional<T>>;

   template <Packable... Ts>
   struct is_packable<std::tuple<Ts...>>;

   template <Packable... Ts>
   struct is_packable<std::variant<Ts...>>;

   // Default implementations for is_packable<T>
   template <typename T, typename Derived>
   struct base_packable_impl : std::bool_constant<true>
   {
      // // Pack object into a single contiguous region
      // template <typename S>
      // static void pack(const T& value, S& stream);

      // True if T is a variable-sized container and it is empty
      static bool is_empty_container(const T& value) { return false; }

      template <bool Verify>
      static bool clear_container(T* value)
      {
         value->clear();
         return true;
      }

      // Pack either:
      // * Object content if T is fixed size
      // * Space for offset if T is variable size. Must write 0 if is_empty_container().
      template <typename S>
      static void embedded_fixed_pack(const T& value, S& stream)
      {
         if constexpr (Derived::is_variable_size)
            stream.write_raw(uint32_t(0));
         else
            Derived::pack(value, stream);
      }

      // Repack offset if T is variable size
      template <typename S>
      static void embedded_fixed_repack(const T& value,
                                        uint32_t fixed_pos,
                                        uint32_t heap_pos,
                                        S&       stream)
      {
         if (Derived::is_variable_size && !Derived::is_empty_container(value))
            stream.rewrite_raw(fixed_pos, heap_pos - fixed_pos);
      }

      // Pack object content if T is variable size
      template <typename S>
      static void embedded_variable_pack(const T& value, S& stream)
      {
         if (Derived::is_variable_size && !Derived::is_empty_container(value))
            Derived::pack(value, stream);
      }

      // // Unpack and/or Verify object in a single contiguous region
      // template <bool Unpack, bool Verify>
      // [[nodiscard]] static bool unpack(T*          value,
      //                                  bool&       has_unknown,
      //                                  bool&       known_end,
      //                                  const char* src,
      //                                  uint32_t&   pos,
      //                                  uint32_t    end_pos);

      // Unpack and/or Verify object which is pointed to by an offset
      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_variable_unpack(T*          value,
                                                         bool&       has_unknown,
                                                         bool&       known_pos,
                                                         const char* src,
                                                         uint32_t&   fixed_pos,
                                                         uint32_t    end_fixed_pos,
                                                         uint32_t&   heap_pos,
                                                         uint32_t    end_heap_pos)
      {
         uint32_t orig_pos = fixed_pos;
         uint32_t offset;
         if (!unpack_numeric<Verify>(&offset, src, fixed_pos, end_fixed_pos))
            return false;
         if constexpr (Derived::supports_0_offset)
         {
            if (offset == 0)
            {
               if constexpr (Unpack)
                  if (!Derived::template clear_container<Verify>(value))
                     return false;
               if constexpr (Verify)
                  known_pos = true;
               return true;
            }
         }
         uint32_t new_heap_pos = orig_pos + offset;
         if constexpr (Verify)
         {
            if (offset < 4 || new_heap_pos < heap_pos || new_heap_pos > end_heap_pos)
               return false;
            if (new_heap_pos != heap_pos && known_pos)
               return false;
            if constexpr (Derived::supports_0_offset)
               if (Derived::is_empty_container(src, new_heap_pos, end_heap_pos))
                  return false;
         }
         heap_pos = new_heap_pos;
         return Derived::template unpack<Unpack, Verify>(value, has_unknown, known_pos, src,
                                                         heap_pos, end_heap_pos);
      }

      // Unpack and/or verify either:
      // * Object at fixed_pos if T is fixed size
      // * Object at offset if T is variable size
      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_unpack(T*          value,
                                                bool&       has_unknown,
                                                bool&       known_pos,
                                                const char* src,
                                                uint32_t&   fixed_pos,
                                                uint32_t    end_fixed_pos,
                                                uint32_t&   heap_pos,
                                                uint32_t    end_heap_pos)
      {
         if constexpr (Derived::is_variable_size)
            return Derived::template embedded_variable_unpack<Unpack, Verify>(
                value, has_unknown, known_pos, src, fixed_pos, end_fixed_pos, heap_pos,
                end_heap_pos);
         else
            return Derived::template unpack<Unpack, Verify>(value, has_unknown, known_pos, src,
                                                            fixed_pos, end_fixed_pos);
      }
   };  // base_packable_impl

   template <PackableMemcpy T>
   struct is_packable<T> : base_packable_impl<T, is_packable<T>>
   {
      static constexpr uint32_t fixed_size        = sizeof(T);
      static constexpr bool     is_variable_size  = false;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = false;

      template <typename S>
      static void pack(const T& value, S& stream)
      {
         stream.write_raw(value);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(T*          value,
                                       bool&       has_unknown,
                                       bool&       known_end,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         if constexpr (Verify)
         {
            known_end = true;
            if (end_pos - pos < sizeof(T))
               return false;
         }
         if constexpr (Unpack)
            std::memcpy(value, src + pos, sizeof(T));
         pos += sizeof(T);
         return true;
      }
   };  // is_packable<PackableMemcpy>

   template <bool Verify, PackableNumeric T>
   [[nodiscard]] bool unpack_numeric(T* value, const char* src, uint32_t& pos, uint32_t end_pos)
   {
      bool has_unknown, known_end;
      return is_packable<T>::template unpack<true, Verify>(value, has_unknown, known_end, src, pos,
                                                           end_pos);
   }

   template <>
   struct is_packable<bool> : base_packable_impl<bool, is_packable<bool>>
   {
      static constexpr uint32_t fixed_size        = 1;
      static constexpr bool     is_variable_size  = false;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = false;

      template <typename S>
      static void pack(const bool& value, S& stream)
      {
         stream.write_raw(value);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(bool*       value,
                                       bool&       has_unknown,
                                       bool&       known_end,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         if constexpr (Verify)
         {
            known_end = true;
            if (end_pos - pos < 1 || static_cast<unsigned char>(src[pos]) > 1)
               return false;
         }
         if constexpr (Unpack)
            *value = src[pos] != 0;
         pos += 1;
         return true;
      }
   };  // is_packable<bool>

   template <PackableWrapper T>
   struct is_packable<T> : std::bool_constant<true>
   {
      using inner = std::remove_cvref_t<decltype(clio_unwrap_packable(std::declval<T&>()))>;
      using is_p  = is_packable<inner>;

      static constexpr uint32_t fixed_size        = is_p::fixed_size;
      static constexpr bool     is_variable_size  = is_p::is_variable_size;
      static constexpr bool     is_optional       = is_p::is_optional;
      static constexpr bool     supports_0_offset = is_p::supports_0_offset;

      static bool has_value(const T& value) { return is_p::has_value(clio_unwrap_packable(value)); }
      template <bool Verify>
      static bool has_value(const char* src, uint32_t pos, uint32_t end_pos)
      {
         return is_p::template has_value<Verify>(src, pos, end_pos);
      }

      template <bool Unpack>
      static inner* ptr(T* value)
      {
         if constexpr (Unpack)
            return &clio_unwrap_packable(*value);
         else
            return nullptr;
      }

      template <typename S>
      static void pack(const T& value, S& stream)
      {
         return is_p::pack(clio_unwrap_packable(value), stream);
      }

      static bool is_empty_container(const T& value)
      {
         return is_p::is_empty_container(clio_unwrap_packable(value));
      }
      static bool is_empty_container(const char* src, uint32_t pos, uint32_t end_pos)
      {
         return is_p::is_empty_container(src, pos, end_pos);
      }

      template <typename S>
      static void embedded_fixed_pack(const T& value, S& stream)
      {
         return is_p::embedded_fixed_pack(clio_unwrap_packable(value), stream);
      }

      template <typename S>
      static void embedded_fixed_repack(const T& value,
                                        uint32_t fixed_pos,
                                        uint32_t heap_pos,
                                        S&       stream)
      {
         return is_p::embedded_fixed_repack(clio_unwrap_packable(value), fixed_pos, heap_pos,
                                            stream);
      }

      template <typename S>
      static void embedded_variable_pack(const T& value, S& stream)
      {
         return is_p::embedded_variable_pack(clio_unwrap_packable(value), stream);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(T*          value,
                                       bool&       has_unknown,
                                       bool&       known_end,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         return is_p::template unpack<Unpack, Verify>(ptr<Unpack>(value), has_unknown, known_end,
                                                      src, pos, end_pos);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_variable_unpack(T*          value,
                                                         bool&       has_unknown,
                                                         bool&       known_end,
                                                         const char* src,
                                                         uint32_t&   fixed_pos,
                                                         uint32_t    end_fixed_pos,
                                                         uint32_t&   heap_pos,
                                                         uint32_t    end_heap_pos)
      {
         // TODO: Does this need to exist?
         return is_p::template embedded_variable_unpack<Unpack, Verify>(
             ptr<Unpack>(value), has_unknown, known_end, src, fixed_pos, end_fixed_pos, heap_pos,
             end_heap_pos);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_unpack(T*          value,
                                                bool&       has_unknown,
                                                bool&       known_end,
                                                const char* src,
                                                uint32_t&   fixed_pos,
                                                uint32_t    end_fixed_pos,
                                                uint32_t&   heap_pos,
                                                uint32_t    end_heap_pos)
      {
         return is_p::template embedded_unpack<Unpack, Verify>(
             ptr<Unpack>(value), has_unknown, known_end, src, fixed_pos, end_fixed_pos, heap_pos,
             end_heap_pos);
      }
   };  // is_packable<PackableWrapper>

   template <typename T, typename Derived>
   struct packable_container_memcpy_impl : base_packable_impl<T, Derived>
   {
      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = true;

      template <typename S>
      static void pack(const T& value, S& stream)
      {
         is_packable<uint32_t>::pack(value.size() * sizeof(typename T::value_type), stream);
         if (value.size())
            stream.write(value.data(), value.size() * sizeof(typename T::value_type));
      }

      static bool is_empty_container(const T& value) { return value.empty(); }
      static bool is_empty_container(const char* src, uint32_t pos, uint32_t end_pos)
      {
         uint32_t fixed_size;
         if (!unpack_numeric<true>(&fixed_size, src, pos, end_pos))
            return false;
         return fixed_size == 0;
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(T*          value,
                                       bool&       has_unknown,
                                       bool&       known_end,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         uint32_t fixed_size;
         if (!unpack_numeric<Verify>(&fixed_size, src, pos, end_pos))
            return false;
         uint32_t size    = fixed_size / sizeof(typename T::value_type);
         uint32_t new_pos = pos + fixed_size;
         if constexpr (Verify)
         {
            known_end = true;
            if ((fixed_size % sizeof(typename T::value_type)) || new_pos < pos || new_pos > end_pos)
               return false;
         }
         if constexpr (Unpack)
         {
            value->resize(size);
            if (size)
               std::memcpy(value->data(), src + pos, fixed_size);
         }
         pos = new_pos;
         return true;
      }
   };  // packable_container_memcpy_impl

   template <>
   struct is_packable<std::string>
       : packable_container_memcpy_impl<std::string, is_packable<std::string>>
   {
   };

   template <>
   struct is_packable<std::string_view>
       : packable_container_memcpy_impl<std::string_view, is_packable<std::string_view>>
   {
   };

   template <PackableMemcpy T>
   struct is_packable<std::span<T>>
       : packable_container_memcpy_impl<std::span<T>, is_packable<std::span<T>>>
   {
   };

   template <Packable T>
      requires(is_packable_memcpy<T>::value)
   struct is_packable<std::vector<T>>
       : packable_container_memcpy_impl<std::vector<T>, is_packable<std::vector<T>>>
   {
   };

   template <Packable T>
      requires(!is_packable_memcpy<T>::value)
   struct is_packable<std::vector<T>>
       : base_packable_impl<std::vector<T>, is_packable<std::vector<T>>>
   {
      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = true;

      template <typename S>
      static void pack(const std::vector<T>& value, S& stream)
      {
         uint32_t num_bytes = value.size() * is_packable<T>::fixed_size;
         assert(num_bytes == value.size() * is_packable<T>::fixed_size);
         is_packable<uint32_t>::pack(num_bytes, stream);
         stream.about_to_write(num_bytes);
         uint32_t fixed_pos = stream.written();
         for (const auto& x : value)
            is_packable<T>::embedded_fixed_pack(x, stream);
         for (const auto& x : value)
         {
            is_packable<T>::embedded_fixed_repack(x, fixed_pos, stream.written(), stream);
            is_packable<T>::embedded_variable_pack(x, stream);
            fixed_pos += is_packable<T>::fixed_size;
         }
      }

      static bool is_empty_container(const std::vector<T>& value) { return value.empty(); }
      static bool is_empty_container(const char* src, uint32_t pos, uint32_t end_pos)
      {
         uint32_t fixed_size;
         if (!unpack_numeric<true>(&fixed_size, src, pos, end_pos))
            return false;
         return fixed_size == 0;
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(std::vector<T>* value,
                                       bool&           has_unknown,
                                       bool&           known_end,
                                       const char*     src,
                                       uint32_t&       pos,
                                       uint32_t        end_pos)
      {
         uint32_t fixed_size;
         if (!unpack_numeric<Verify>(&fixed_size, src, pos, end_pos))
            return false;
         uint32_t size          = fixed_size / is_packable<T>::fixed_size;
         uint32_t fixed_pos     = pos;
         uint32_t heap_pos      = pos + fixed_size;
         uint32_t end_fixed_pos = heap_pos;
         if constexpr (Verify)
         {
            known_end = true;
            if ((fixed_size % is_packable<T>::fixed_size) || heap_pos < pos || heap_pos > end_pos)
               return false;
         }
         if constexpr (Unpack)
         {
            value->resize(size);
            for (auto& x : *value)
               if (!is_packable<T>::template embedded_unpack<Unpack, Verify>(
                       &x, has_unknown, known_end, src, fixed_pos, end_fixed_pos, heap_pos,
                       end_pos))
                  return false;
         }
         else
         {
            for (uint32_t i = 0; i < size; ++i)
               if (!is_packable<T>::template embedded_unpack<Unpack, Verify>(
                       nullptr, has_unknown, known_end, src, fixed_pos, end_fixed_pos, heap_pos,
                       end_pos))
                  return false;
         }
         pos = heap_pos;
         return true;
      }  // unpack
   };    // is_packable<std::vector<T>> (!memcpy)

   template <Packable T, std::size_t N>
      requires(!is_packable_memcpy<T>::value)
   struct is_packable<std::array<T, N>>
       : base_packable_impl<std::array<T, N>, is_packable<std::array<T, N>>>
   {
      static constexpr uint32_t fixed_size =
          is_packable<T>::is_variable_size ? 4 : is_packable<T>::fixed_size * N;
      static constexpr bool is_variable_size  = is_packable<T>::is_variable_size;
      static constexpr bool is_optional       = false;
      static constexpr bool supports_0_offset = false;

      template <typename S>
      static void pack(const std::array<T, N>& value, S& stream)
      {
         stream.about_to_write(is_packable<T>::fixed_size * N);
         uint32_t fixed_pos = stream.written();
         for (const auto& x : value)
            is_packable<T>::embedded_fixed_pack(x, stream);
         for (const auto& x : value)
         {
            is_packable<T>::embedded_fixed_repack(x, fixed_pos, stream.written(), stream);
            is_packable<T>::embedded_variable_pack(x, stream);
            fixed_pos += is_packable<T>::fixed_size;
         }
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(std::array<T, N>* value,
                                       bool&             has_unknown,
                                       bool&             known_end,
                                       const char*       src,
                                       uint32_t&         pos,
                                       uint32_t          end_pos)
      {
         uint32_t fixed_pos     = pos;
         uint32_t heap_pos      = pos + is_packable<T>::fixed_size * N;
         uint32_t end_fixed_pos = heap_pos;
         if constexpr (Verify)
         {
            known_end = true;
            if (heap_pos < pos || heap_pos > end_pos)
               return false;
         }
         if constexpr (Unpack)
         {
            for (auto& x : *value)
               if (!is_packable<T>::template embedded_unpack<Unpack, Verify>(
                       &x, has_unknown, known_end, src, fixed_pos, end_fixed_pos, heap_pos,
                       end_pos))
                  return false;
         }
         else
         {
            for (uint32_t i = 0; i < N; ++i)
               if (!is_packable<T>::template embedded_unpack<Unpack, Verify>(
                       nullptr, has_unknown, known_end, src, fixed_pos, end_fixed_pos, heap_pos,
                       end_pos))
                  return false;
         }
         pos = heap_pos;
         return true;
      }
   };

   template <Packable T>
   struct is_packable<std::optional<T>>
       : base_packable_impl<std::optional<T>, is_packable<std::optional<T>>>
   {
      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = true;
      static constexpr bool     supports_0_offset = false;

      static bool has_value(const std::optional<T>& value) { return value.has_value(); }
      template <bool Verify>
      static bool has_value(const char* src, uint32_t pos, uint32_t end_pos)
      {
         uint32_t offset;
         if (!unpack_numeric<Verify>(&offset, src, pos, end_pos))
            return false;
         return offset != 1;
      }

      template <typename S>
      static void pack(const std::optional<T>& value, S& stream)
      {
         uint32_t fixed_pos = stream.written();
         embedded_fixed_pack(value, stream);
         uint32_t heap_pos = stream.written();
         embedded_fixed_repack(value, fixed_pos, heap_pos, stream);
         embedded_variable_pack(value, stream);
      }

      template <typename S>
      static void embedded_fixed_pack(const std::optional<T>& value, S& stream)
      {
         if (!is_packable<T>::is_optional && is_packable<T>::is_variable_size && value.has_value())
            is_packable<T>::embedded_fixed_pack(*value, stream);
         else
            stream.write_raw(uint32_t(1));
      }

      template <typename S>
      static void embedded_fixed_repack(const std::optional<T>& value,
                                        uint32_t                fixed_pos,
                                        uint32_t                heap_pos,
                                        S&                      stream)
      {
         if (value.has_value())
         {
            if (!is_packable<T>::is_optional && is_packable<T>::is_variable_size)
               is_packable<T>::embedded_fixed_repack(*value, fixed_pos, heap_pos, stream);
            else
               stream.rewrite_raw(fixed_pos, heap_pos - fixed_pos);
         }
      }

      template <typename S>
      static void embedded_variable_pack(const std::optional<T>& value, S& stream)
      {
         if (value.has_value() && !is_packable<T>::is_empty_container(*value))
            is_packable<T>::pack(*value, stream);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(std::optional<T>* value,
                                       bool&             has_unknown,
                                       bool&             known_end,
                                       const char*       src,
                                       uint32_t&         pos,
                                       uint32_t          end_pos)
      {
         uint32_t fixed_pos = pos;
         if constexpr (Verify)
         {
            known_end = true;
            if (end_pos - pos < 4)
            {
               return false;
            }
         }
         pos += 4;
         uint32_t end_fixed_pos = pos;
         return embedded_unpack<Unpack, Verify>(value, has_unknown, known_end, src, fixed_pos,
                                                end_fixed_pos, pos, end_pos);
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool embedded_unpack(std::optional<T>* value,
                                                bool&             has_unknown,
                                                bool&             known_pos,
                                                const char*       src,
                                                uint32_t&         fixed_pos,
                                                uint32_t          end_fixed_pos,
                                                uint32_t&         heap_pos,
                                                uint32_t          end_heap_pos)
      {
         uint32_t orig_pos = fixed_pos;
         uint32_t offset;
         if (!unpack_numeric<Verify>(&offset, src, fixed_pos, end_fixed_pos))
            return false;
         if (offset == 1)
         {
            if constexpr (Unpack)
            {
               *value = std::nullopt;
            }
            return true;
         }
         fixed_pos = orig_pos;
         if constexpr (Unpack)
         {
            value->emplace();
         }
         return is_packable<T>::template embedded_variable_unpack<Unpack, Verify>(
             Unpack ? &**value : nullptr, has_unknown, known_pos, src, fixed_pos, end_fixed_pos,
             heap_pos, end_heap_pos);
      }
   };  // is_packable<std::optional<T>>

   inline bool verify_extensions(const char* src,
                                 bool        known_pos,
                                 bool&       last_has_value,
                                 uint32_t    fixed_pos,
                                 uint32_t    end_fixed_pos,
                                 uint32_t&   heap_pos,
                                 uint32_t    end_heap_pos)
   {
      if ((end_fixed_pos - fixed_pos) % 4 != 0)
         return false;
      while (fixed_pos < end_fixed_pos)
      {
         uint32_t offset;
         auto     base = fixed_pos;
         if (!unpack_numeric<false>(&offset, src, fixed_pos, end_fixed_pos))
            return false;
         last_has_value = offset != 1;
         if (offset >= 2)
         {
            if (offset < 4)
               return false;
            if (known_pos && offset + base != heap_pos)
               return false;
            if (offset > end_heap_pos - base)
               return false;
            if (offset < heap_pos - base)
               return false;
            heap_pos  = base + offset;
            known_pos = false;
         }
      }
      return true;
   }

   template <Packable... Ts>
   struct is_packable<std::tuple<Ts...>>
       : base_packable_impl<std::tuple<Ts...>, is_packable<std::tuple<Ts...>>>
   {
      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = false;

      template <typename S>
      static void pack(const std::tuple<Ts...>& value, S& stream)
      {
         // TODO: verify fixed_size doesn't overflow
         int num_present = 0;
         int i           = 0;
         tuple_foreach(  //
             value,
             [&](const auto& x)
             {
                using is_p = is_packable<std::remove_cvref_t<decltype(x)>>;
                ++i;
                if constexpr (is_p::is_optional)
                {
                   if (is_p::has_value(x))
                      num_present = i;
                }
                else
                {
                   num_present = i;
                }
             });
         uint16_t fixed_size = 0;
         i                   = 0;
         tuple_foreach(  //
             value,
             [&](const auto& x)
             {
                using is_p = is_packable<std::remove_cvref_t<decltype(x)>>;
                if (i < num_present)
                   fixed_size += is_p::fixed_size;
                ++i;
             });
         is_packable<uint16_t>::pack(fixed_size, stream);
         uint32_t fixed_pos = stream.written();
         i                  = 0;
         tuple_foreach(  //
             value,
             [&](const auto& x)
             {
                using is_p = is_packable<std::remove_cvref_t<decltype(x)>>;
                if (i < num_present)
                   is_p::embedded_fixed_pack(x, stream);
                ++i;
             });
         i = 0;
         tuple_foreach(  //
             value,
             [&](const auto& x)
             {
                using is_p = is_packable<std::remove_cvref_t<decltype(x)>>;
                if (i < num_present)
                {
                   is_p::embedded_fixed_repack(x, fixed_pos, stream.written(), stream);
                   is_p::embedded_variable_pack(x, stream);
                   fixed_pos += is_p::fixed_size;
                }
                ++i;
             });
      }  // pack

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(std::tuple<Ts...>* value,
                                       bool&              has_unknown,
                                       bool&              known_end,
                                       const char*        src,
                                       uint32_t&          pos,
                                       uint32_t           end_pos)
      {
         uint16_t fixed_size;
         if (!unpack_numeric<Verify>(&fixed_size, src, pos, end_pos))
            return false;
         uint32_t fixed_pos     = pos;
         uint32_t heap_pos      = pos + fixed_size;
         uint32_t end_fixed_pos = heap_pos;
         if constexpr (Verify)
         {
            known_end = true;
            if (heap_pos < pos || heap_pos > end_pos)
               return false;
         }
         bool ok             = true;
         bool last_has_value = true;
         if constexpr (Unpack)
         {
            tuple_foreach(  //
                *value,
                [&](auto& x)
                {
                   using is_p = is_packable<std::remove_cvref_t<decltype(x)>>;
                   if (fixed_pos < end_fixed_pos || !is_p::is_optional)
                   {
                      ok &= is_p::template embedded_unpack<Unpack, Verify>(
                          &x, has_unknown, known_end, src, fixed_pos, end_fixed_pos, heap_pos,
                          end_pos);
                      if constexpr (Verify)
                      {
                         if constexpr (is_p::is_optional)
                         {
                            last_has_value = is_p::has_value(x);
                         }
                         else
                         {
                            last_has_value = true;
                         }
                      }
                   }
                });
         }
         else
         {
            tuple_foreach_type(  //
                (std::tuple<Ts...>*)nullptr,
                [&](auto* p)
                {
                   using is_p = is_packable<std::remove_cvref_t<decltype(*p)>>;
                   if (fixed_pos < end_fixed_pos || !is_p::is_optional)
                   {
                      if constexpr (Verify)
                      {
                         if constexpr (is_p::is_optional)
                         {
                            last_has_value =
                                is_p::template has_value<Verify>(src, fixed_pos, end_fixed_pos);
                         }
                         else
                         {
                            last_has_value = true;
                         }
                      }
                      ok &= is_p::template embedded_unpack<Unpack, Verify>(
                          nullptr, has_unknown, known_end, src, fixed_pos, end_fixed_pos, heap_pos,
                          end_pos);
                   }
                });
         }
         if (!ok)
            return false;
         if constexpr (Verify)
         {
            if (fixed_pos < end_fixed_pos)
            {
               if (!verify_extensions(src, known_end, last_has_value, fixed_pos, end_fixed_pos,
                                      heap_pos, end_pos))
                  return false;
               has_unknown = true;
               known_end   = false;
            }
            if (!last_has_value)
               return false;
         }
         pos = heap_pos;
         return true;
      }  // unpack
   };    // is_packable<std::tuple<Ts...>>

   template <bool Unpack, bool Verify, size_t I, typename... Ts>
   [[nodiscard]] bool unpack_variant_impl(size_t               tag,
                                          std::variant<Ts...>* value,
                                          bool&                has_unknown,
                                          bool&                end_known,
                                          const char*          src,
                                          uint32_t&            pos,
                                          uint32_t             end_pos)
   {
      if constexpr (I < sizeof...(Ts))
      {
         using is_p = is_packable<std::variant_alternative_t<I, std::variant<Ts...>>>;
         if (tag == I)
         {
            if constexpr (Unpack)
            {
               value->template emplace<I>();
               return is_p::template unpack<Unpack, Verify>(&std::get<I>(*value), has_unknown,
                                                            end_known, src, pos, end_pos);
            }
            else
            {
               return is_p::template unpack<Unpack, Verify>(nullptr, has_unknown, end_known, src,
                                                            pos, end_pos);
            }
         }
         else
         {
            return unpack_variant_impl<Unpack, Verify, I + 1>(tag, value, has_unknown, end_known,
                                                              src, pos, end_pos);
         }
      }
      else
      {
         return false;
      }
   }

   template <Packable... Ts>
   struct is_packable<std::variant<Ts...>>
       : base_packable_impl<std::variant<Ts...>, is_packable<std::variant<Ts...>>>
   {
      static_assert(sizeof...(Ts) < 128);

      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = false;

      template <typename S>
      static void pack(const std::variant<Ts...>& value, S& stream)
      {
         is_packable<uint8_t>::pack(value.index(), stream);
         uint32_t size_pos = stream.written();
         is_packable<uint32_t>::pack(0, stream);
         uint32_t content_pos = stream.written();
         std::visit([&](const auto& x)
                    { is_packable<std::remove_cvref_t<decltype(x)>>::pack(x, stream); },
                    value);
         stream.rewrite_raw(size_pos, uint32_t(stream.written() - content_pos));
      }

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(std::variant<Ts...>* value,
                                       bool&                has_unknown,
                                       bool&                known_end,
                                       const char*          src,
                                       uint32_t&            pos,
                                       uint32_t             end_pos)
      {
         uint8_t tag;
         if (!unpack_numeric<Verify>(&tag, src, pos, end_pos))
            return false;
         if constexpr (Verify)
            if (tag & 0x80)
               return false;
         uint32_t size;
         if (!unpack_numeric<Verify>(&size, src, pos, end_pos))
            return false;
         uint32_t content_pos = pos;
         uint32_t content_end = pos + size;
         if constexpr (Verify)
            if (content_end < content_pos || content_end > end_pos)
               return false;
         bool inner_known_end;
         if (!unpack_variant_impl<Unpack, Verify, 0>(tag, value, has_unknown, inner_known_end, src,
                                                     content_pos, content_end))
            return false;
         if constexpr (Verify)
         {
            known_end = true;
            if (inner_known_end && content_pos != content_end)
               return false;
         }
         pos = content_end;
         return true;
      }
   };  // is_packable<std::variant<Ts...>>

   template <typename T>
   struct is_packable_reflected<T, true> : base_packable_impl<T, is_packable<T>>
   {
      static constexpr uint32_t get_members_fixed_size()
      {
         uint32_t size = 0;
         reflect<T>::for_each(
             [&](const meta& ref, auto member)
             {
                using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                if constexpr (!m::isFunction)
                   size += is_packable<typename m::ValueType>::fixed_size;
             });
         return size;
      }

      static constexpr bool get_is_var_size()
      {
         if (!reflect<T>::definitionWillNotChange)
            return true;
         bool is_var = false;
         reflect<T>::for_each(
             [&](const meta& ref, auto member)
             {
                using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                if constexpr (!m::isFunction)
                   is_var |= is_packable<typename m::ValueType>::is_variable_size;
             });
         return is_var;
      }

      static constexpr uint32_t members_fixed_size = get_members_fixed_size();
      static constexpr bool     is_variable_size   = get_is_var_size();
      static constexpr uint32_t fixed_size         = is_variable_size ? 4 : members_fixed_size;
      static constexpr bool     is_optional        = false;
      static constexpr bool     supports_0_offset  = false;

      static_assert(members_fixed_size <= 0xffff);

      template <typename S>
      static void pack(const T& value, S& stream)
      {
         if constexpr (is_variable_size)
         {
            int num_present = 0;
            int i           = 0;
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                   {
                      ++i;
                      if constexpr (is_packable<typename m::ValueType>::is_optional &&
                                    !reflect<T>::definitionWillNotChange)
                      {
                         if (is_packable<typename m::ValueType>::has_value(value.*member(&value)))
                            num_present = i;
                      }
                      else
                      {
                         num_present = i;
                      }
                   }
                });
            uint16_t fixed_size = 0;
            i                   = 0;
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                   {
                      if (i < num_present)
                         fixed_size += is_packable<typename m::ValueType>::fixed_size;
                      ++i;
                   }
                });
            if constexpr (!reflect<T>::definitionWillNotChange)
               is_packable<uint16_t>::pack(fixed_size, stream);
            uint32_t fixed_pos = stream.written();
            i                  = 0;
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                   {
                      if (i < num_present)
                         is_packable<typename m::ValueType>::embedded_fixed_pack(
                             value.*member(&value), stream);
                      ++i;
                   }
                });
            i = 0;
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                   {
                      if (i < num_present)
                      {
                         using is_p = is_packable<typename m::ValueType>;
                         is_p::embedded_fixed_repack(value.*member(&value), fixed_pos,
                                                     stream.written(), stream);
                         is_p::embedded_variable_pack(value.*member(&value), stream);
                         fixed_pos += is_p::fixed_size;
                      }
                      ++i;
                   }
                });
         }  // is_variable_size
         else
         {
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                      is_packable<typename m::ValueType>::pack(value.*member(&value), stream);
                });
         }
      }  // pack

      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(T*          value,
                                       bool&       has_unknown,
                                       bool&       known_end,
                                       const char* src,
                                       uint32_t&   pos,
                                       uint32_t    end_pos)
      {
         if constexpr (is_variable_size)
         {
            uint16_t fixed_size;
            if constexpr (reflect<T>::definitionWillNotChange)
               fixed_size = members_fixed_size;
            else if (!unpack_numeric<Verify>(&fixed_size, src, pos, end_pos))
               return false;
            uint32_t fixed_pos     = pos;
            uint32_t heap_pos      = pos + fixed_size;
            uint32_t end_fixed_pos = heap_pos;
            if constexpr (Verify)
            {
               if (heap_pos < pos || heap_pos > end_pos)
                  return false;
               known_end = true;
            }
            bool ok             = true;
            bool last_has_value = true;
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                   {
                      using is_p = is_packable<typename m::ValueType>;
                      if (fixed_pos < end_fixed_pos || !is_p::is_optional)
                      {
                         if constexpr (Verify)
                         {
                            if constexpr (is_p::is_optional && !reflect<T>::definitionWillNotChange)
                            {
                               last_has_value =
                                   is_p::template has_value<Verify>(src, fixed_pos, end_fixed_pos);
                            }
                            else
                            {
                               last_has_value = true;
                            }
                         }
                         if constexpr (Unpack)
                            ok &= is_p::template embedded_unpack<Unpack, Verify>(
                                &(value->*member(value)), has_unknown, known_end, src, fixed_pos,
                                end_fixed_pos, heap_pos, end_pos);
                         else
                         {
                            ok &= is_p::template embedded_unpack<Unpack, Verify>(
                                nullptr, has_unknown, known_end, src, fixed_pos, end_fixed_pos,
                                heap_pos, end_pos);
                         }
                      }
                   }
                });
            if (!ok)
               return false;
            if constexpr (Verify)
            {
               if (fixed_pos < end_fixed_pos)
               {
                  if (!verify_extensions(src, known_end, last_has_value, fixed_pos, end_fixed_pos,
                                         heap_pos, end_pos))
                     return false;
                  has_unknown = true;
                  known_end   = false;
               }
               if (!last_has_value)
                  return false;
            }
            pos = heap_pos;
            return true;
         }  // is_variable_size
         else
         {
            bool ok = true;
            if constexpr (Verify)
            {
               known_end = true;
            }
            reflect<T>::for_each(
                [&](const meta& ref, auto member)
                {
                   using m = MemberPtrType<decltype(member(std::declval<T*>()))>;
                   if constexpr (!m::isFunction)
                   {
                      using is_p = is_packable<typename m::ValueType>;
                      if constexpr (Unpack)
                         ok &= is_p::template unpack<Unpack, Verify>(
                             &(value->*member(value)), has_unknown, known_end, src, pos, end_pos);
                      else
                         ok &= is_p::template unpack<Unpack, Verify>(nullptr, has_unknown,
                                                                     known_end, src, pos, end_pos);
                   }
                });
            return ok;
         }
      }  // unpack
   };    // is_packable_reflected

   template <Packable T, typename S>
   void to_frac(const T& value, S& stream)
   {
      psio::is_packable<T>::pack(value, stream);
   }

   template <Packable T>
   std::uint32_t fracpack_size(const T& value)
   {
      size_stream ss;
      psio::to_frac(value, ss);
      return ss.size;
   }

   template <Packable T>
   std::vector<char> to_frac(const T& value)
   {
      std::vector<char> result(psio::fracpack_size(value));
      fast_buf_stream   s(result.data(), result.size());
      psio::to_frac(value, s);
      return result;
   }

   template <Packable T>
   auto convert_to_frac(const T& value)
   {
      return to_frac(value);
   }

   enum validation_t : std::uint8_t
   {
      invalid,
      valid,
      extended,
   };
   template <Packable T>
   validation_t fracpack_validate(std::span<const char> data)
   {
      bool          has_unknown = false;
      bool          known_end;
      std::uint32_t pos = 0;
      if (!is_packable<T>::template unpack<false, true>(nullptr, has_unknown, known_end,
                                                        data.data(), pos, data.size()))
         return validation_t::invalid;
      if (known_end && pos != data.size())
         return validation_t::invalid;
      return has_unknown ? validation_t::extended : validation_t::valid;
   }
   template <Packable T>
   bool fracpack_validate_compatible(std::span<const char> data)
   {
      return fracpack_validate<T>(data) != validation_t::invalid;
   }
   template <Packable T>
   bool fracpack_validate_strict(std::span<const char> data)
   {
      return fracpack_validate<T>(data) == validation_t::valid;
   }

   template <typename T>
   struct prevalidated
   {
      template <typename... A>
      explicit constexpr prevalidated(A&&... a) : data(std::forward<A>(a)...)
      {
      }
      T data;
   };
   template <typename T>
   prevalidated(T&) -> prevalidated<T&>;
   template <typename T>
   prevalidated(T*&) -> prevalidated<T*>;
   template <typename T>
   prevalidated(T* const&) -> prevalidated<T*>;
   template <typename T>
   prevalidated(T&&) -> prevalidated<T>;
   template <typename T, typename U>
   prevalidated(T&& t, U&& u)
       -> prevalidated<decltype(std::span{std::forward<T>(t), std::forward<U>(u)})>;
   struct input_stream;
   prevalidated(input_stream)->prevalidated<std::span<const char>>;

   template <Packable T>
   bool from_frac(T& value, std::span<const char> data)
   {
      bool          has_unknown = false;
      bool          known_end;
      std::uint32_t pos = 0;
      if (!is_packable<T>::template unpack<true, true>(&value, has_unknown, known_end, data.data(),
                                                       pos, data.size()))
         return false;
      if (known_end && pos != data.size())
         return false;
      return true;
   }

   template <Packable T>
   T from_frac(std::span<const char> data)
   {
      T result;
      if (!from_frac(result, data))
         abort_error(stream_error::invalid_frac_encoding);
      return result;
   }

   template <Packable T>
   bool from_frac_strict(T& value, std::span<const char> data)
   {
      bool          has_unknown = false;
      bool          known_end;
      std::uint32_t pos = 0;
      if (!is_packable<T>::template unpack<true, true>(&value, has_unknown, known_end, data.data(),
                                                       pos, data.size()))
         return false;
      if (has_unknown)
         return false;
      if (known_end && pos != data.size())
         return false;
      return true;
   }

   template <Packable T>
   T from_frac_strict(std::span<const char> data)
   {
      T result;
      if (!from_frac_strict(result, data))
         abort_error(stream_error::invalid_frac_encoding);
      return result;
   }

   template <Packable T, typename S>
   T from_frac(const prevalidated<S>& data)
   {
      bool                  has_unknown = false;
      bool                  known_end;
      std::uint32_t         pos = 0;
      T                     result;
      std::span<const char> actual(data.data);
      (void)is_packable<T>::template unpack<true, false>(&result, has_unknown, known_end,
                                                         actual.data(), pos, actual.size());
      return result;
   }
}  // namespace psio

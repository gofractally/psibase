#pragma once

#include <psio/view.hpp>

#include <cassert>
#include <cstring>
#include <type_traits>

namespace psio
{

   /* used so as not to confuse with other types that might be used to consrtuct shared_view*/
   struct size_tag
   {
      uint32_t size;
   };

   /**
     *  A shared_ptr<char> array containing the data
     *  
     *  uint32_t    size
     *  char[size]  fracpack(T) 
     */
   template <typename T>
      requires Packable<std::remove_cv_t<T>>
   class shared_view_ptr
   {
     public:
      typedef T value_type;

      shared_view_ptr() = default;
      shared_view_ptr(std::nullptr_t){};
      shared_view_ptr(const T& from) : shared_view_ptr{size_tag{psio::fracpack_size(from)}}
      {
         fast_buf_stream out(data(), size());
         psio::to_frac(from, out);
      }

      shared_view_ptr(const char* data, std::uint32_t size)
          : shared_view_ptr{validate({data, size})}
      {
      }

      template <typename U>
      shared_view_ptr(const prevalidated<U>& data)
          : shared_view_ptr{prevalidated{std::span<const char>(data.data)}}
      {
      }

      shared_view_ptr(const prevalidated<std::span<const char>>& data)
          : shared_view_ptr{size_tag{static_cast<std::uint32_t>(data.data.size())}}
      {
         std::memcpy(this->data(), data.data.data(), data.data.size());
      }

      template <typename U>
         requires(std::is_same_v<T, const U>)
      shared_view_ptr(const shared_view_ptr<U>& other) : _data(other.data)
      {
      }

      template <typename U>
         requires(std::is_same_v<T, const U>)
      shared_view_ptr(shared_view_ptr<U>&& other) : _data(std::move(other.data))
      {
      }

      /** allocate the memory so another function can fill it in */
      explicit shared_view_ptr(size_tag s)
          : _data{std::make_shared_for_overwrite<char[]>(s.size + sizeof(s.size))}
      {
         memcpy(_data.get(), &s.size, sizeof(s.size));
      }

      explicit operator bool() const { return _data != nullptr; }

      auto operator*() const { return view<T>(prevalidated{data()}); }
      auto operator->() const { return operator_arrow_proxy{**this}; }

      /** returns the data without a size prefix */
      char_ptr<T> data() const
      {
         assert(!!_data);
         return _data.get() + 4;
      }

      std::span<const char> data_with_size_prefix() const
      {
         return std::string_view(_data.get(), size() + sizeof(uint32_t));
      }

      std::span<const char> data_without_size_prefix() const
      {
         return std::string_view(data(), size());
      }

      /** @return the number of bytes of packed data after the size prefix */
      size_t size() const
      {
         assert(!!_data);
         uint32_t s;
         memcpy(&s, _data.get(), sizeof(s));
         return s;
      }

      void reset() { _data.reset(); }

     private:
      static auto validate(const std::span<const char>& data)
      {
         if (!frackpack_validate_compatible<std::remove_cv_t<T>>(data))
            abort_error(stream_error::invalid_frac_encoding);
         return prevalidated<std::span<const char>>{data};
      }
      template <typename U>
      friend class shared_view_ptr;
      std::shared_ptr<char[]> _data;
   };

   template <typename T>
   auto shared_view_ptr_strict(const char* data, std::uint32_t size)
   {
      if (!frackpack_validate_strict<std::remove_cv_t<T>>({data, size}))
         abort_error(stream_error::invalid_frac_encoding);
      return shared_view_ptr<T>{prevalidated{std::span{data, size}}};
   }

   template <typename T>
   constexpr bool is_shared_view_ptr_v = false;
   template <typename T>
   constexpr bool is_shared_view_ptr_v<shared_view_ptr<T>> = true;

   template <typename T>
   using shared_view_char_t =
       std::conditional_t<std::is_const_v<T> || std::is_const_v<typename T::value_type>,
                          const char,
                          char>;

   template <typename T>
      requires(is_shared_view_ptr_v<std::remove_cv_t<T>>)
   struct view_interface<T> : view_base<T>
   {
      using value_type = typename T::value_type;
      explicit operator bool() const { return true; }
      auto     operator*() const
      {
         return view<std::conditional_t<std::is_const_v<T>, const value_type, value_type>>{
             prevalidated{view_base<T>::data + 4}};
      }
      auto                   operator->() const { return operator_arrow_proxy{**this}; }
      shared_view_char_t<T>* data() const { return view_base<T>::data + 4; }
      std::uint32_t          size() const
      {
         uint32_t      result;
         std::uint32_t pos = 0;
         (void)unpack_numeric<false>(&result, view_base<T>::data, pos, 4);
         return result;
      }
      std::span<const char> data_with_size_prefix() const
      {
         return std::span(view_base<T>::data, size() + 4);
      }
      std::span<const char> data_without_size_prefix() const { return std::span(data(), size()); }
   };

   template <typename T>
   struct is_packable<shared_view_ptr<T>>
       : base_packable_impl<shared_view_ptr<T>, is_packable<shared_view_ptr<T>>>
   {
      static constexpr uint32_t fixed_size        = 4;
      static constexpr bool     is_variable_size  = true;
      static constexpr bool     is_optional       = false;
      static constexpr bool     supports_0_offset = true;

      static bool is_empty_container(const shared_view_ptr<T>& value) { return value.size() == 0; }
      static bool is_empty_container(const char* src, uint32_t pos, uint32_t end_pos)
      {
         uint32_t fixed_size;
         if (!unpack_numeric<true>(&fixed_size, src, pos, end_pos))
            return false;
         return fixed_size == 0;
      }

      static void pack(const shared_view_ptr<T>& ptr, auto& stream)
      {
         assert(!!ptr);
         auto data = ptr.data_with_size_prefix();
         stream.write(data.data(), data.size());
      }
      template <bool Unpack, bool Verify>
      [[nodiscard]] static bool unpack(shared_view_ptr<T>* value,
                                       bool&               has_unknown,
                                       bool&               known_end,
                                       const char*         src,
                                       uint32_t&           pos,
                                       uint32_t            end_pos)
      {
         uint32_t size;
         if (!unpack_numeric<Verify>(&size, src, pos, end_pos))
            return false;
         if constexpr (Verify)
         {
            if (size > end_pos - pos)
               return false;
            bool          inner_known_end;
            std::uint32_t inner_pos = pos;
            if (!is_packable<T>::template unpack<false, Verify>(
                    nullptr, has_unknown, inner_known_end, src, inner_pos, pos + size))
               return false;
            if (inner_known_end && inner_pos != pos + size)
               return false;
            known_end = true;
         }
         if constexpr (Unpack)
         {
            // TODO: consider whether to allow sharing ownership with an
            // existing shared_ptr instead of copying
            *value = shared_view_ptr<T>{prevalidated{std::span{src + pos, size}}};
         }
         pos += size;
         return true;
      }
   };
}  // namespace psio

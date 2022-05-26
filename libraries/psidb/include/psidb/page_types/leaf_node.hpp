#pragma once

#include <cstdint>
#include <string_view>

namespace psidb
{

   struct leaf_ptr
   {
      leaf_ptr() = default;
      leaf_ptr(page_header* parent, void* loc) : parent(parent), loc(loc) {}
      page_header* parent;
      void*        loc;
      template <typename Page>
      Page* get_parent() const
      {
         return static_cast<Page*>(parent);
      }
   };

   static_assert(sizeof(page_internal_node) == page_size);
   static_assert(sizeof(page_internal_node::_buf) % 16 == 0);

   // A leaf holds key-value pairs
   struct page_leaf : page_header
   {
      static constexpr std::size_t capacity = (page_size - sizeof(page_header) - 2) / 36;
      static constexpr std::size_t max_inline_value_size = 16;
      // each kv pair is at least 32-bytes
      std::uint8_t size;
      std::uint8_t total_words;
      struct kv_storage
      {
         std::uint8_t          offset;
         std::uint8_t          key_size;
         std::uint8_t          value_size;
         std::uint8_t          flags;  // ignored for now
         constexpr std::size_t size() { return (key_size + value_size) * 16; }
      };
      char       padding[16 - (sizeof(page_header) + 2 + capacity * sizeof(kv_storage)) % 16];
      kv_storage key_values[capacity];
      char buf[page_size - sizeof(page_header) - capacity * sizeof(kv_storage) - sizeof(padding) -
               2];
      void clear()
      {
         size        = 0;
         total_words = 0;
      }
      static std::string_view unpad(std::string_view data)
      {
         return {data.data(), data.data() + data.size() - 16 + data.back()};
      }
      std::string_view get_key(kv_storage kv) const
      {
         return {buf + kv.offset * 16, buf + kv.offset * 16 + kv.key_size * 16};
      }
      std::pair<std::string_view, std::uint8_t> get_value(kv_storage kv) const
      {
         return {{buf + kv.offset * 16 + kv.key_size * 16,
                  buf + kv.offset * 16 + kv.key_size * 16 + kv.value_size * 16},
                 kv.flags};
      }
      std::string_view get_key(uint16_t idx) const { return get_key(key_values[idx]); }
      std::pair<std::string_view, std::uint8_t> get_value(uint16_t idx) const
      {
         return get_value(key_values[idx]);
      }

      leaf_ptr child(std::uint16_t idx) { return {this, key_values + idx}; }
      leaf_ptr back() { return child(size - 1); }

      std::uint32_t get_offset(leaf_ptr pos) const
      {
         return static_cast<kv_storage*>(pos.loc) - key_values;
      }
      // Pads the string to a multiple of 16-bytes and appends it to buf.
      void append_padded(std::string_view data)
      {
         std::memcpy(buf + total_words * 16, data.data(), data.size());
         std::memset(buf + total_words * 16 + data.size(), 0, 15 - data.size() % 16);
         buf[total_words * 16 + (data.size() | 0xF)] = data.size() % 16;
         total_words += data.size() / 16 + 1;
      }
      void append_to_buf(std::string_view data)
      {
         assert(data.size() > 0);
         assert(data.size() % 16 == 0);
         std::memcpy(buf + total_words * 16, data.data(), data.size());
         total_words += data.size() / 16;
      }
      // \pre the key must be greater than any key currently in the node
      // \pre key and value must be correctly padded
      void append_internal(std::string_view key, std::string_view value, std::uint8_t flags)
      {
         assert(size < capacity);
         key_values[size] = {total_words, static_cast<std::uint8_t>(key.size() / 16),
                             static_cast<std::uint8_t>(value.size() / 16), flags};
         ++size;
         append_to_buf(key);
         append_to_buf(value);
      }
      void copy(page_leaf* other)
      {
         other->size        = 0;
         other->total_words = 0;
         other->type        = page_type::leaf;
         for (std::size_t i = 0; i < size; ++i)
         {
            auto [value, flags] = get_value(i);
            other->append_internal(get_key(i), value, flags);
         }
      }
      std::string_view split(page_leaf*       other,
                             std::uint16_t    idx,
                             key_type         key,
                             std::string_view value,
                             std::uint8_t     flags)
      {
         std::uint32_t total_kv_size = 0;
         other->size                 = 0;
         other->total_words          = 0;
         other->type                 = page_type::leaf;
         auto copy_some              = [&](std::uint32_t start, std::uint32_t end)
         {
            for (; start != end; ++start)
            {
               auto [value, flags] = get_value(start);
               other->append_internal(get_key(start), value, flags);
            }
         };
         for (std::uint32_t i = 0; i < idx; ++i)
         {
            total_kv_size += key_values[i].size();
            if (total_kv_size > sizeof(buf) / 2)
            {
               copy_some(i, idx);
               other->insert_unchecked(other->size, key, value, flags);
               copy_some(idx, size);
               truncate(i);
               return other->get_key(0);
            }
         }
         {
            total_kv_size += key.size() + value.size();
            if (total_kv_size > sizeof(buf) / 2)
            {
               other->insert_unchecked(other->size, key, value, flags);
               copy_some(idx, size);
               truncate(idx);
               return other->get_key(0);
            }
         }
         for (std::uint32_t i = idx; i < size; ++i)
         {
            total_kv_size += key_values[i].size();
            if (total_kv_size > sizeof(buf) / 2)
            {
               copy_some(i, size);
               // OPT: truncate and insert can be merged
               truncate(i);
               insert_unchecked(idx, key, value, flags);
               return other->get_key(0);
            }
         }
         // unreachable, because split should only be called
         // when total_kv_size > sizeof(buf)
         __builtin_unreachable();
      }
      // Removes keys at pos and above
      // \post size == pos
      void truncate(std::uint16_t pos)
      {
         char          tmp[sizeof(buf)];
         std::uint32_t offset        = 0;
         auto          append_string = [&](std::string_view data)
         {
            std::memcpy(tmp + offset, data.data(), data.size());
            offset += data.size();
         };
         for (std::uint32_t i = 0; i < pos; ++i)
         {
            auto& kv          = key_values[i];
            auto  prev_offset = offset;
            append_string(get_key(kv));
            append_string(get_value(kv).first);
            kv.offset = prev_offset / 16;
         }
         std::memcpy(buf, tmp, offset);
         size        = pos;
         total_words = offset / 16;
      }
      bool insert_unchecked(std::uint16_t    pos,
                            key_type         key,
                            std::string_view value,
                            std::uint8_t     flags)
      {
         assert(size < capacity);
         shift_array(key_values + pos, key_values + size);
         ++size;
         if (flags)
         {
            key_values[pos] = {total_words, static_cast<std::uint8_t>(key.size() / 16 + 1),
                               static_cast<std::uint8_t>(value.size() / 16), flags};
            append_padded(key);
            append_to_buf(value);
         }
         else
         {
            key_values[pos] = {total_words, static_cast<std::uint8_t>(key.size() / 16 + 1),
                               static_cast<std::uint8_t>(value.size() / 16 + 1), flags};
            append_padded(key);
            append_padded(value);
         }
         return true;
      }
      bool insert(leaf_ptr pos, key_type key, std::string_view value, std::uint8_t flags)
      {
         if (total_words * 16 + ((key.size() / 16) + (value.size() / 16) + 2) * 16 > sizeof(buf))
         {
            return false;
         }
         insert_unchecked(get_offset(pos), key, value, flags);
         return true;
      }
      void erase(leaf_ptr pos)
      {
         auto*      ptr = static_cast<kv_storage*>(pos.loc);
         kv_storage tmp = *ptr;
         shift_array_left(ptr, key_values + size);
         key_values[size - 1] = tmp;
         // TODO: This is pretty inefficient
         truncate(size - 1);
      }
      leaf_ptr lower_bound(std::string_view key)
      {
         std::uint16_t low = 0, high = size;
         while (low + 1 < high)
         {
            auto mid = low + (high - low) / 2;
            if (key <= unpad(get_key(mid)))
            {
               high = mid;
            }
            else
            {
               low = mid;
            }
         }
         if (key <= unpad(get_key(low)))
         {
            return {this, key_values + low};
         }
         else
         {
            return {this, key_values + high};
         }
      }
   };

   static_assert(sizeof(page_leaf) == page_size);

}  // namespace psidb

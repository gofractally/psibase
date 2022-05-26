#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <psidb/node_ptr.hpp>
#include <psidb/page_header.hpp>
#include <psidb/sync/shared_value.hpp>
#include <span>

namespace psidb
{

   static_assert(sizeof(std::atomic<page_id>) == sizeof(page_id));

   // moves data from [start, end) to [start+1, end+1)
   template <typename T>
   void shift_array(T* start, T* end)
   {
      std::memmove(start + 1, start, (end - start) * sizeof(T));
   }

   // moves data from [start + 1, end) to [start, end - 1)
   template <typename T>
   void shift_array_left(T* start, T* end)
   {
      std::memmove(start, start + 1, (end - start - 1) * sizeof(T));
   }

   static std::string_view unpad(std::string_view data)
   {
      return {data.data(), data.data() + data.size() - 16 + data.back()};
   }

   // Page types must:
   // - be standard layout
   // - have a trivial default constructor
   // - be trivially copyable
   struct page_internal_node : page_header
   {
      using relink_record = char;
      std::uint8_t _size;
      std::uint8_t _key_words;

      // Keys are 16-byte aligned and padded to a multiple of 16 bytes
      struct key_storage
      {
         constexpr key_storage() = default;
         constexpr key_storage(std::size_t offset, std::size_t size)
             : shifted_offset(offset / 16), shifted_size(size / 16)
         {
         }
         std::uint8_t            shifted_offset;
         std::uint8_t            shifted_size;
         constexpr std::uint16_t offset() const { return shifted_offset * 16; }
         constexpr std::uint16_t size() const { return shifted_size * 16; }
      };

      static constexpr std::size_t header_size =
          sizeof(page_header) + sizeof(_size) + sizeof(_key_words) + sizeof(page_id);
      static constexpr std::size_t min_key_size     = 16;
      static constexpr std::size_t fixed_entry_size = sizeof(page_id) + sizeof(key_storage);
      static constexpr std::size_t min_entry_size   = min_key_size + fixed_entry_size;

      static constexpr std::size_t capacity = (page_size - header_size) / min_entry_size;
      // Align buf to a multiple of 16 bytes
      static constexpr std::size_t padding =
          (page_size - header_size - capacity * fixed_entry_size) % 16 / sizeof(key_storage);
      key_storage          _keys[capacity + padding];
      std::atomic<page_id> _children[capacity + 1];
      char                 _buf[page_size - header_size - capacity * fixed_entry_size -
                padding * sizeof(key_storage)];

      // Construct a new object
      void init()
      { /*_mutex.init();*/
      }

      void start_transaction(relink_record* queue) { lock(); }
      // queue must be the same as the queue that was passed to start_transaction
      void end_transaction(relink_record* queue) { unlock(); }

      // accessors
      std::string_view get_key(key_storage k) const
      {
         return {_buf + k.offset(), _buf + k.offset() + k.size()};
      }
      std::string_view get_key(std::uint16_t idx) const { return get_key(_keys[idx]); }
      std::string_view get_key(node_ptr pos) const { return get_key(get_offset(pos)); }
      node_ptr         child(uint16_t idx) { return {this, &_children[idx]}; }
      node_ptr         back() { return child(_size); }
      uint16_t         get_offset(node_ptr pos) const { return pos.get() - _children; }

      std::span<std::atomic<page_id>> get_children() { return {_children, _children + _size + 1}; }

      // internal modifiers
      void append(std::string_view k, page_id rhs) { insert_unchecked(_size, k, rhs); }
      // \pre the most recently inserted key must be at the end
      void pop_back()
      {
         --_size;
         _key_words -= _keys[_size].shifted_size;
      }
      void set(page_id first)
      {
         _size        = 0;
         _key_words   = 0;
         _children[0] = first;
      }
      void set(page_id lhs, std::string_view k, page_id rhs)
      {
         set(lhs);
         append(k, rhs);
      }
      void copy(page_internal_node* other)
      {
         relink_record tmp_buffer[capacity + 1];
         other->init();
         other->start_transaction(tmp_buffer);
         other->set(_children[0]);
         for (std::uint32_t i = 0; i < _size; ++i)
         {
            other->append(get_key(i), _children[i + 1].load(std::memory_order_relaxed));
         }
         other->end_transaction(tmp_buffer);
      }
      // \return the key corresponding to the midpoint.  The result points to
      // memory owned by one of the nodes and is invalidated by any modification to
      // either node.
      std::string_view split(page_internal_node* other,
                             std::uint16_t       idx,
                             std::string_view    k,
                             page_id             p)
      {
         relink_record tmp_buffer[capacity + 1];
         std::uint32_t total_key_size = 0;
         auto          copy_some      = [&](std::uint32_t start, std::uint32_t end)
         {
            for (; start != end; ++start)
            {
               other->append(get_key(start), _children[start + 1]);
            }
         };
         // OPT: This loop can be vectorized
         for (std::uint32_t i = 0; i < idx; ++i)
         {
            total_key_size += _keys[i].size();
            if (total_key_size > sizeof(_buf) / 2)
            {
               // TODO: copy keys before linking the new node in.  The transaction
               // only needs to be around the copy of the child links.
               other->init();
               other->start_transaction(tmp_buffer);
               other->set(_children[i + 1]);
               copy_some(i + 1, idx);
               other->append(k, p);
               copy_some(idx, _size);
               other->end_transaction(tmp_buffer);
               start_transaction(tmp_buffer);
               truncate(i + 1);
               pop_back();
               end_transaction(tmp_buffer);
               return this->get_key(i);
            }
         }
         {
            total_key_size += k.size();
            if (total_key_size > sizeof(_buf) / 2)
            {
               other->init();
               other->start_transaction(tmp_buffer);
               other->set(p);
               copy_some(idx, _size);
               other->end_transaction(tmp_buffer);
               start_transaction(tmp_buffer);
               truncate(idx);
               end_transaction(tmp_buffer);
               return k;
            }
         }
         for (std::uint32_t i = idx; i < _size; ++i)
         {
            total_key_size += _keys[i].size();
            if (total_key_size > sizeof(_buf) / 2)
            {
               other->init();
               other->start_transaction(tmp_buffer);
               other->set(_children[i + 1]);
               copy_some(i + 1, _size);
               other->append(get_key(i), 0);
               other->pop_back();
               other->end_transaction(tmp_buffer);
               start_transaction(tmp_buffer);
               truncate(i);
               insert_unchecked(idx, k, p);
               end_transaction(tmp_buffer);
               return other->get_key(other->_size);
            }
         }
         __builtin_unreachable();
      }

      void truncate(std::uint16_t pos)
      {
         char          tmp[sizeof(_buf)];
         std::uint32_t offset        = 0;
         auto          append_string = [&](std::string_view data)
         {
            std::memcpy(tmp + offset, data.data(), data.size());
            offset += data.size();
         };
         for (std::uint32_t i = 0; i < pos; ++i)
         {
            auto& keyref      = _keys[i];
            auto  prev_offset = offset;
            append_string(get_key(keyref));
            keyref.shifted_offset = prev_offset / 16;
         }
         std::memcpy(_buf, tmp, offset);
         _size      = pos;
         _key_words = offset / 16;
      }
      bool insert(node_ptr pos, std::string_view key, page_id p)
      {
         if (_key_words * 16 + key.size() > sizeof(_buf) || _size >= capacity)
         {
            return false;
         }
         relink_record tmp_buffer[capacity + 1];
         start_transaction(tmp_buffer);
         insert_unchecked(get_offset(pos), key, p);
         end_transaction(tmp_buffer);
         return true;
      }
      void insert_unchecked(std::uint16_t idx, std::string_view key, page_id p)
      {
         assert(_size < capacity);
         // copy key
         std::memcpy(_buf + _key_words * 16, key.data(), key.size());
         shift_array(_keys + idx, _keys + _size);
         _keys[idx] = {static_cast<std::uint16_t>(_key_words * 16), key.size()};
         // FIXME: making this work correctly with concurrent garbage collection
         // can be done with only load + store release (no atomic RMW), but
         // requires very close attention to order of operations.
         // The required guarantee is that a concurrent scan of the array will
         // always see all the old elements, may or may not see the new
         // element and may see spurious duplicates.  But... relinking
         // is a problem.
         shift_array(_children + idx, _children + _size + 1);
         _children[idx + 1].store(p, std::memory_order_relaxed);
         ++_size;
         _key_words += key.size() / 16;
      }
      void erase(node_ptr pos)
      {
         auto          offset = get_offset(pos);
         relink_record tmp_buffer[capacity + 1];
         start_transaction(tmp_buffer);
         if (offset != _size)
         {
            auto tmp = _keys[offset];
            shift_array_left(_keys + offset, _keys + _size);
            _keys[_size - 1] = tmp;
         }
         {
            auto tmp = _children[offset].load(std::memory_order_relaxed);
            shift_array_left(_children + offset, _children + _size + 1);
            _children[_size].store(tmp, std::memory_order_relaxed);
         }
         // TODO: This is pretty inefficient
         truncate(_size - 1);
         end_transaction(tmp_buffer);
      }

      node_ptr lower_bound(std::string_view key)
      {
         std::uint16_t low = 0, high = _size;
         while (low + 1 < high)
         {
            auto mid = low + (high - low) / 2;
            if (key < unpad(get_key(mid)))
            {
               high = mid;
            }
            else
            {
               low = mid;
            }
         }
         if (key < unpad(get_key(low)))
         {
            return {this, _children + low};
         }
         else
         {
            return {this, _children + high};
         }
      }
   };

   static_assert(sizeof(page_internal_node) == page_size);
}  // namespace psidb

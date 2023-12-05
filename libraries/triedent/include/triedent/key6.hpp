#pragma once
#include <cassert>

namespace triedent {

   using key_view   = std::string_view;
   using value_view = std::string_view;
   using key_type   = std::string;
   using value_type = key_type;

   inline key_type from_key6(const key_view sixb);

   template <typename KeyType>
   inline void from_key6(const key_view sixb, KeyType& out);

   // used to avoid malloc, because keys can be at most 256,
   // this one change produced 13% improvment with 12 threads
   struct temp_key6
   {
      uint32_t _size = 0;
      char     _buffer[128];

      uint32_t    size() const { return _size; }
      const char* begin() const { return _buffer; }
      const char* end() const { return _buffer + _size; }
      char*       begin() { return _buffer; }
      char*       end() { return _buffer + _size; }

      void append(const char* p, const char* e)
      {
         int s = e - p;
         if (_size + s > sizeof(_buffer))
            throw std::runtime_error("key length overflow");
         memcpy(end(), p, s);
         _size += s;
      }
      void push_back(char c)
      {
         if (_size < sizeof(_buffer))
         {
            *end() = c;
            ++_size;
         }
         else
         {
            throw std::runtime_error("key length overflow");
         }
      }
      void resize(uint32_t s)
      {
         if (s < sizeof(_buffer))
         {
            _size = s;
         }
         else
         {
            throw std::runtime_error("key length overflow");
         }
      }
      const char* data() const { return begin(); }
      char*       data() { return begin(); }

      void insert(char* pos, const char* begin, const char* end)
      {
         assert(pos >= _buffer and pos < _buffer + sizeof(_buffer));
    //     assert((const char*)pos + end - begin < _buffer + sizeof(_buffer));
         memcpy(pos, begin, end - begin);
         _size += end - begin;
      }

      temp_key6() : _size(0) {}

     private:
      temp_key6(const temp_key6&) = delete;  // should not be copied
   };

   inline key_type from_key6(const key_view sixb)
   {
      key_type tmp;
      from_key6(sixb, tmp);
      return tmp;
   }

   template <typename KeyType>
   inline void from_key6(const key_view sixb, KeyType& out)
   {
      out.resize((sixb.size() * 6) / 8);

      const uint8_t* pos6     = (uint8_t*)sixb.data();
      const uint8_t* pos6_end = (uint8_t*)sixb.data() + sixb.size();
      uint8_t*       pos8     = (uint8_t*)out.data();

      while (pos6_end - pos6 >= 4)
      {
         pos8[0] = (pos6[0] << 2) | (pos6[1] >> 4);  // 6 + 2t
         pos8[1] = (pos6[1] << 4) | (pos6[2] >> 2);  // 4b + 4t
         pos8[2] = (pos6[2] << 6) | pos6[3];         // 2b + 6
         pos6 += 4;
         pos8 += 3;
      }
      switch (pos6_end - pos6)
      {
         case 3:
            pos8[0] = (pos6[0] << 2) | (pos6[1] >> 4);  // 6 + 2t
            pos8[1] = (pos6[1] << 4) | (pos6[2] >> 2);  // 4b + 4t
            //    pos8[2] = (pos6[2] << 6);                   // 2b + 6-0
            break;
         case 2:
            pos8[0] = (pos6[0] << 2) | (pos6[1] >> 4);  // 6 + 2t
            //     pos8[1] = (pos6[1] << 4);                   // 4b + 4-0
            break;
         case 1:
            pos8[0] = (pos6[0] << 2);  // 6 + 2-0
            break;
      }
   }
   inline key_view to_key6(key_type& key_buf, key_view v)
   {
      uint32_t bits  = v.size() * 8;
      uint32_t byte6 = (bits + 5) / 6;

      key_buf.resize(byte6);

      uint8_t*       pos6     = (uint8_t*)key_buf.data();
      const uint8_t* pos8     = (uint8_t*)v.data();
      const uint8_t* pos8_end = (uint8_t*)v.data() + v.size();

      while (pos8_end - pos8 >= 3)
      {
         pos6[0] = pos8[0] >> 2;
         pos6[1] = (pos8[0] & 0x3) << 4 | pos8[1] >> 4;
         pos6[2] = (pos8[1] & 0xf) << 2 | (pos8[2] >> 6);
         pos6[3] = pos8[2] & 0x3f;
         pos8 += 3;
         pos6 += 4;
      }

      switch (pos8_end - pos8)
      {
         case 2:
            pos6[0] = pos8[0] >> 2;
            pos6[1] = (pos8[0] & 0x3) << 4 | pos8[1] >> 4;
            pos6[2] = (pos8[1] & 0xf) << 2;
            break;
         case 1:
            pos6[0] = pos8[0] >> 2;
            pos6[1] = (pos8[0] & 0x3) << 4;
            break;
         default:
            break;
      }
      return {key_buf.data(), key_buf.size()};
   }


}

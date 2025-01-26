#pragma once

namespace arbtrie {
   using saturated_uint32 = uint32_t;
   /*
   struct saturated_uint32
   {
      saturated_uint32(uint32_t v = 0) : _value(v) {}

      saturated_uint32& operator-=(uint32_t v)
      {
         uint32_t c = _value - v;
         if (c > _value) [[unlikely]]
            _value = 0;
         else
            _value = c;
         return *this;
      }

      saturated_uint32& operator+=(uint32_t v)
      {
         uint32_t c = _value + v;
         if (c < _value) [[unlikely]]
            _value = -1;
         else
            _value = c;
         return *this;
      }

      uint32_t value() const { return _value; }

     private:
      uint32_t _value = 0;
   };
   static_assert(sizeof(saturated_uint32) == sizeof(uint32_t));
   */
}

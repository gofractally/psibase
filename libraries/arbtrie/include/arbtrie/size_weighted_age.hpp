#pragma once
#include <arbtrie/rdtsc.hpp>
#include <arbtrie/util.hpp>

namespace arbtrie
{

   /**
    * Facilitatesthe accumulation of a weighted average age in a single
    * uint64_t
    */
   struct size_weighted_age
   {
      static constexpr const uint64_t read_cl_mask = make_mask<0, 21>();
      static constexpr const uint64_t time_ms_mask = make_mask<21, 43>();

      size_weighted_age() : read_cl(0), time_ms(0) {}
      size_weighted_age(uint64_t data) { *this = std::bit_cast<size_weighted_age>(data); }
      //:read_cl(data & read_cl_mask), time_ms(data >> 21){}

      uint64_t to_int() const { return std::bit_cast<uint64_t>(*this); }

      size_weighted_age& update(uint32_t clines, uint64_t time)
      {
         // data-weighted average time
         time_ms = (time_ms * read_cl + time * clines) / (read_cl + clines);
         read_cl += clines;
         return *this;
      }

      using duration_type = std::chrono::duration<uint64_t, std::milli>;
      using clock_type    = std::chrono::steady_clock;

      /**
       *  TODO: we can insert at over 300,000 keys per second, which means
       *  we are doing millions of allocations per second, but because this is
       *  ms resolution most of the precision is being wasted. Instead this
       *  time should be read from a global variable periodically updated by
       *  the compactor thread. Initial tests show that adding this sys call 
       *  at every alloc has dropped insert performance by about 7% 
       */
      static uint64_t now()
      {
         return rdtsc() >> 20;
         return 1;  //std::chrono::duration_cast<duration_type>(clock_type::now().time_since_epoch()).count();
      }

      uint64_t read_cl : 21;  // read cachelines, 21 bits supports up to 128MB segments
      uint64_t time_ms : 43;  // miliseconds from unix start time
   };

}  // namespace arbtrie

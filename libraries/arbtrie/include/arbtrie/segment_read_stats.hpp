namespace arbtrie {

   /**
    * Each session maintains a count of the total size of all
    * objects that they set the read bit to true on. This is so
    * that one read session does not interfer with the counts on
    * other read sessions.
    *
    * The compactor will iterate over all sessions and sum the
    * total read bytes of all segments from time to time. 
    *
    * The compactor will do an atomic exchange restoring the count
    * to 0
    */
   struct segment_read_stat {
      uint32_t bytes_read( uint32_t segment_num ) const {
         auto& atom       = _stats[segment_num/3];
         // memory order relaxed can be used because no other memory
         // is being synchronized on this.
         auto group       = atom.load( std::memory_order_relaxed );
         auto cache_lines = (group >> 21*(segment_num % 3)) & 0x1fffff;
         return cache_lines * cacheline_size;
      }
      uint64_t total_bytes_read()const {
         return _total.load(std::memory_order_relaxed);
      }

      void read_bytes( uint32_t segment_num, uint32_t bytes ) {
         uint64_t clines = (bytes + (cacheline_size-1))/cacheline_size;
         assert( (clines & ~uint64_t(0x1fffff)) == 0 );
         auto& atom = _stats[segment_num/3];
         uint64_t delta = clines << (21 * (segment_num%3));

         // relaxed is fine because no other data is synchronized on this
         atom.fetch_add(delta, std::memory_order_relaxed);
         // 
         _total.fetch_add(clines*64, std::memory_order_relaxed);
      }

      /**
       * adds the data from other into this and clears other.
       *
       * We can add them as 64 bit numbers because we know that
       * each 21 bit range will not over flow so long as segment_size
       * is less than 2^21 cachelines (128MB).
       *
       * TODO: there is no reason to accumulate into an atomic array
       * when only the compactor thread reads and writes the accumulated
       * data...
       *
       * TODO: only accumulate to the actual max segment, not the
       * theorietical... 
       */
      segment_read_stat& accumulate( segment_read_stat& other, uint32_t num) {
         static_assert( segment_size / cacheline_size <= (1<<21) );
         assert( num <= _stats.size() );
         if( other.total_bytes_read() == 0 )
            return *this;

         auto* opos = other._stats.data();
         auto* oend = opos + num;
         auto* mpos = _stats.data();

         while( opos != oend ) {
            auto val = opos->exchange( 0, std::memory_order_relaxed );
            mpos->fetch_add( val, std::memory_order_relaxed );
            ++opos;
            ++mpos;
         }

         return *this;
      }

      private:
         std::atomic<uint64_t>                                     _total;
         std::array<std::atomic<uint64_t>,(max_segment_count+2)/3> _stats;
   };
}

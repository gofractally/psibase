#include <trie/debug.hpp>
#include <trie/ring_alloc.hpp>

namespace trie
{
   managed_ring::header::header(uint64_t s)
   {
      total_free_bytes  = 0;
      total_alloc_bytes = 0;
      size              = s;
      auto header_size  = (sizeof(*this) + 7) & -8;
      begin             = reinterpret_cast<object_header*>((char*)this + header_size);
      alloc_cursor      = begin;
      swap_cursor       = begin;
      alloc_cursor->set_free_area_size(size - header_size);
      end = reinterpret_cast<object_header*>((char*)this + size);
   }

   managed_ring::managed_ring(std::filesystem::path            filename,
                              uint64_t                         max_size,
                              ring_allocator::cache_level_type lev,
                              bool                             pin)
       : level(lev)
   {
      DEBUG("Creating ", filename.generic_string(), " with size ", max_size / 1024 / 1024 / 1024.,
            " GB");
      uint64_t file_size = 0;
      bool     init      = false;
      if (not std::filesystem::exists(filename))
      {
         init = true;
         std::filesystem::create_directories(filename.parent_path());
         {
            std::ofstream file(filename.generic_string(), std::ofstream::trunc);
            file.close();
         }
      }

      file_size = std::filesystem::file_size(filename);
      if (file_size < max_size)
      {
         file_size = (max_size + 7) & -8;
         std::filesystem::resize_file(filename, file_size);
      }

      _file_map.reset(new bip::file_mapping(filename.generic_string().c_str(), bip::read_write));
      _map_region.reset(new bip::mapped_region(*_file_map, bip::read_write));

      if (init)
         _head = new ((char*)_map_region->get_address()) header(file_size);
      else
         _head = (header*)_map_region->get_address();

      _head->update_size(file_size);

      if (pin)
      {
         DEBUG("Pinning ", file_size / 1024 / 1024 / 1024., " GB");
         if (mlock(_map_region->get_address(), file_size) < 0)
         {
            WARN("Attempt to pin memory failed, performance may be impacted");
         }
      }
      _begin = _head->begin.get();
      _end   = _head->end.get();
   }

   void managed_ring::header::update_size(uint64_t new_size)
   {
      if (new_size == size)
         return;

      auto new_end_pos    = file_begin_pos() + new_size;
      auto new_free_space = new_end_pos - end_pos();
      auto e              = end.get();
      e->size             = 0;
      e->id               = new_free_space;

      end = reinterpret_cast<object_header*>(new_end_pos);
   }


   ring_allocator::ring_allocator(std::filesystem::path dir, access_mode mode, config cfg)
   {
      std::filesystem::create_directories(dir);
      _obj_ids = std::make_unique<object_db>(dir / "objects", id{cfg.max_ids}, mode == read_write);

      _levels[hot_cache].reset(
          new managed_ring(dir / "hot", cfg.hot_pages * 4096, hot_cache, true));
      _levels[warm_cache].reset(
          new managed_ring(dir / "warm", cfg.warm_pages * 4096, warm_cache, true));
      _levels[cool_cache].reset(
          new managed_ring(dir / "cool", cfg.cool_pages * 4096, cool_cache, false));
      _levels[cold_cache].reset(
          new managed_ring(dir / "cold", cfg.cold_pages * 4096, cold_cache, false));
   }

   std::pair<object_id, char*> ring_allocator::alloc(size_t num_bytes)
   {
      auto new_id = _obj_ids->alloc();
      auto ptr    = alloc(hot(), new_id, num_bytes);
      return {new_id, ptr};
   }

   //=================================
   //   alloc
   //=================================
   template <bool CopyData>
   char* ring_allocator::alloc(managed_ring& ring, id nid, uint32_t num_bytes, char* data)
   {
      uint32_t round_size = (num_bytes + 7) & -8;  // data padding
      uint64_t used_size  = round_size + sizeof(object_header);

      ring._head->total_alloc_bytes += used_size + 8;

      auto cur = ring.alloc_cursor().get();
      if (cur->free_area_size() < used_size + 8)  // need 8 for next obj
      {
         cur = ring._begin;
         if (cur->size != 0 or cur->id < used_size + 8)  // need 8 for next obj
         {
            WARN("cur->size; ", cur->size, "  cur->id: ", cur->id, " used_size: ", used_size);
            dump();
            throw std::runtime_error("out of space, run GC or increase DB size");
            return nullptr;
         }
      }
      auto next_obj = reinterpret_cast<object_header*>(((char*)cur) + used_size);

      auto free_size = cur->free_area_size() - used_size;
      next_obj->set_free_area_size(free_size);
      if (free_size == 8)
      {
         WARN("FREE SIZE == 8");
         if (((char*)next_obj) + 8 == (char*)ring._end)
         {
            WARN("OBJ IS AT END... WRAP it..\n");
            next_obj = ring._begin;
         }
      }

      ring.alloc_cursor() = next_obj;

      cur->set(nid, num_bytes);
      if constexpr (CopyData)
      {
         memcpy(cur->data(), data, num_bytes);
      }
      _obj_ids->set(nid, (char*)cur - ring.begin_pos(), ring.level);

      return cur->data();
   }

   // moves data from higher levels to lower levels
   // can be run in any single thread because it doesn't modify the
   // source and it is the only modifies free areas of lower levels
   void ring_allocator::swap()
   {
      auto do_swap = [this](auto* from, auto* to)
      {
         auto fs     = from->free_space();
         auto maxs   = from->_head->size;
         auto target = maxs / 16;  // target a certain amount free

         if (target < fs)
            return;
        // WARN("target: ", target, "  free space: ", fs, " from: ", from->level, " to: ", to->level);


         auto bytes = target - fs;

         uint64_t bytes_swapped = 0;

         auto from_sc = from->swap_cursor().get();
         auto ac      = from->alloc_cursor().get();

         while (from_sc != ac and bytes_swapped < bytes)
         {
            //    DEBUG("bytes swapped: ", bytes_swapped, " bytes: ", bytes);
            //    DEBUG("ac - from_sc: ", ac - from_sc);
            if (from_sc->is_free_area())
               from_sc = from_sc->end_free();

            if (from_sc == from->_end)
               from_sc = from->_begin;

            uint16_t ref;
            auto     loc = _obj_ids->get({from_sc->id}, ref);
            if ((loc.cache == from->level) & ref)
            {
               //      DEBUG("moving data to lower level");
               alloc<true>(*to, {from_sc->id}, from_sc->size, from_sc->data());
            }
            /*
            else
            {
               if (not ref)
                  DEBUG("object freed, nothing to move to swap");
               else
                  DEBUG("object already moved to another level");
            }
            */
            auto nxt = from_sc->next();

            bytes_swapped += (char*)nxt - (char*)from_sc;
            from_sc = nxt;
         }
         from->_head->total_free_bytes += bytes_swapped;

         from->swap_cursor() = from_sc;
      };
      //      DEBUG( "PRE SWAP HOT WARM" );
      //     hot().dump(*_obj_ids);
      do_swap(&hot(), &warm());
      //    hot().dump(*_obj_ids);
      //   DEBUG( "END SWAP HOT WARM / START WARM TO COOL" );
      //  warm().dump(*_obj_ids);
      do_swap(&warm(), &cool());
      // warm().dump(*_obj_ids);
      //DEBUG( "END WARM TO COOL / STARRT COOL TO COLD" );
      //   cool().dump(*_obj_ids);
      do_swap(&cool(), &cold());
      do_swap(&cold(), &cold());
   }

   // updates the free range after swapping, this allows alloc to start
   // reusing this space. Must make sure any threads reading are done
   // before advancing free space.
   void ring_allocator::claim_free()
   {
      auto claim = [this](auto* ring)
      {
         auto* alloc_pos = ring->alloc_cursor().get();
         auto* swap_pos  = ring->swap_cursor().get();

         if (swap_pos > alloc_pos)
         {
            //  WARN("growing free area to swap pos");
            alloc_pos->set_free_area_size((char*)swap_pos - (char*)alloc_pos);
         }
         else
         {  // we must have wrapped
            // WARN("growing free area to end of file");
            // TODO: what about leaving space for a NULL obj at the end
            alloc_pos->set_free_area_size(ring->end_pos() - (char*)alloc_pos);
            if (ring->_begin != swap_pos)
            {
               WARN("creating free area from front to swap pos");
               ring->_begin->set_free_area_size((char*)swap_pos - ring->begin_pos());
               //dump();
            }
         }
      };
      claim(&hot());
      claim(&warm());
      claim(&cool());
      claim(&cold());
   }

   void ring_allocator::retain(id i) { _obj_ids->retain(i); }
   void ring_allocator::release(id i) { _obj_ids->release(i); }

   //  pointer is valid until GC runs, reads can read it then check to see if
   //  the gc moved past char* while reading then read again at new location
   char* ring_allocator::get(id i)
   {
      auto loc = _obj_ids->get(i);

      if (loc.cache == hot_cache)
         return hot().get_object(loc.offset)->data();

      auto obj = _levels[loc.cache]->get_object(loc.offset);

      auto ptr = alloc(hot(), id{obj->id}, obj->size);
      memcpy(ptr, obj->data(), obj->size);
      return ptr;
   }

   void managed_ring::dump(object_db& odb)
   {
      std::cerr << "size: " << _head->size << "   ";
      std::cerr << "alloc_cursor free area: " << alloc_cursor()->free_area_size() << "  ";
      std::cerr << "alloc_cursor pos: " << ((char*)alloc_cursor().get()) - begin_pos() << "   ";
      std::cerr << "swap_cursor pos: " << ((char*)swap_cursor().get()) - begin_pos() << "  ";
      std::cerr << "free space: " << free_space() << "\n";
      std::cerr << "total alloced: " << _head->total_alloc_bytes << "\n";
      std::cerr << "total freed: " << _head->total_free_bytes << "\n";
      std::cerr << "net : " << (_head->total_alloc_bytes - _head->total_free_bytes)/1024/1024./1024 << " GB\n";

      auto print_from = [&,this](auto* ob)
      {
         auto s     = _head->swap_cursor.get();
         auto a     = _head->alloc_cursor.get();
         auto b     = _begin;
         auto e     = _end;
         int  count = 0;
         auto c     = ob;
         if (c == e)
         {
            WARN("alloc is at the end!!\n");
         }
         if (s == e)
         {
            WARN("swap is at the end!!\n");
         }
         while (c != e)
         {
            if (++count > 10)
               break;
            if (c == b)
               std::cerr << "\033[31mB\033[0m";
            if (c == e)
               std::cerr << "\033[31mE\033[0m";
            if (c == s)
               std::cerr << "\033[31mS\033[0m";
            if (c == a)
               std::cerr << "\033[31mA\033[0m";
            if (c->is_free_area())
            {
               std::cerr << "\033[33m["
                         << "FREE"
                         << ", " << c->id << "b]\033[0m";
               c = c->end_free();
            }
            else
            {
               uint16_t ref;
               auto     loc = odb.get({c->id}, ref);
               if (loc.cache == level and ref)
                  std::cerr << "[" << c->size << ", #" << c->id << " r" << ref << "]";
               else if (0 == ref)
               {
                  std::cerr << "\033[94m{" << c->size << ", #" << c->id << "f}\033[0m";
               }
               else
               {
                  std::cerr << "\033[36m(" << c->size << ", #" << c->id << "s)\033[0m";
               }
               c = c->next();
            }
         }
         std::cerr << "\n";
      };
         auto a     = _head->alloc_cursor.get();
         auto b     = _begin;
      print_from(a);
      print_from(b);
   }

   void ring_allocator::dump()
   {
      std::cerr << "============= HOT ================== \n";
      hot().dump(*_obj_ids);
      std::cerr << "\n============= WARM ================== \n";
      warm().dump(*_obj_ids);
      std::cerr << "\n============= COOL ================== \n";
      cool().dump(*_obj_ids);
      std::cerr << "\n============= COLD ================== \n";
      cold().dump(*_obj_ids);
      std::cerr << "================================= \n";
   }

}  // namespace trie

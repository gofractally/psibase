#include <trie/object_arena.hpp>

namespace trie
{

   object_arena::object_arena(std::filesystem::path dir,
                              access_mode           mode,
                              uint64_t              max_objects,
                              uint64_t              hot_cache_bytes,
                              uint64_t              cold_cache_bytes,
                              uint64_t              big_hot_cache_bytes,
                              uint64_t              big_cold_cache_bytes)
   {
      bool init           = false;
      auto hot_file       = dir / "hot";
      auto cold_file      = dir / "cold";
      auto hot_mru_file   = dir / "hot_mru";
      auto hot_free_file  = dir / "hot_free";
      auto cold_free_file = dir / "cold_free";
      auto big_hot_file   = dir / "big_hot";
      auto big_cold_file  = dir / "big_cold";

      if (max_objects > 1ull << 40)
         throw std::runtime_error("max object count must be less than 2^40");
      if (hot_cache_bytes % 4096 != 0)
         throw std::runtime_error("hot cache size must be multiple of 4096");
      if (cold_cache_bytes % 4096 != 0)
         throw std::runtime_error("cold cache size must be multiple of 4096");

      if (not std::filesystem::exists(dir))
      {
         if (mode != read_write)
            throw std::runtime_error("directory '" + dir.generic_string() + "' does not exist");

         std::cerr << "creating object arena directory " << dir.generic_string() << "/\n";

         std::filesystem::create_directories(dir);

         init = true;
      }
      _obj_db = std::make_unique<object_db>(dir / "objects", id{max_objects}, mode == read_write);

      auto md = mode == read_write ? bip::read_write : bip::read_only;

      auto create_or_resize =
          [mode, md](auto path, auto& file, auto& region, uint64_t& size, bool lock)
      {
         if (mode == read_write)
         {
            if (not std::filesystem::exists(path))
            {
               std::cerr << "creating'" << path << "'\n";
               std::ofstream f(path.generic_string(), std::ofstream::trunc);
               f.close();  /// cross platform support
            }
            auto existing_size = std::filesystem::file_size(path);
            if (existing_size < size)
            {
               std::cerr << "resizing '" << path << "' to " << size / 1024 / 1024. << " MB\n";
               std::filesystem::resize_file(path, size);
            }
            else
            {
               size = existing_size;
            }
         }
         file   = std::make_unique<bip::file_mapping>(path.generic_string().c_str(), md);
         region = std::make_unique<bip::mapped_region>(*file, md);

         madvise(region->get_address(), size, MADV_RANDOM);
         if (lock and mlock(region->get_address(), size) < 0)
         {
            std::cerr << "warning: unable to lock memory for " << path.generic_string()
                      << ". Performance may be degraded\n";
         }
      };

      auto hot_file_size      = hot_cache_bytes;
      auto cold_file_size     = cold_cache_bytes;
      auto big_hot_file_size  = big_hot_cache_bytes;
      auto big_cold_file_size = big_cold_cache_bytes;

      create_or_resize(hot_file, _hot_file, _hot_region, hot_file_size, true);
      create_or_resize(cold_file, _cold_file, _cold_region, cold_file_size, false);
      create_or_resize(big_hot_file, _big_hot_file, _big_hot_region, big_hot_file_size, true);
      create_or_resize(big_cold_file, _big_cold_file, _big_cold_region, big_cold_file_size, false);

      auto hot_mru_size   = (hot_file_size / page_size) * sizeof(list_node);
      auto hot_free_size  = (hot_file_size / page_size) * sizeof(list_node);
      auto cold_free_size = (cold_file_size / page_size) * sizeof(list_node);

      create_or_resize(hot_mru_file, _hot_mru_file, _hot_mru_region, hot_mru_size, true);
      create_or_resize(hot_free_file, _hot_free_file, _hot_free_region, hot_free_size, true);
      create_or_resize(cold_free_file, _cold_free_file, _cold_free_region, cold_free_size, true);

      hot.header     = reinterpret_cast<object_arena_header*>(_hot_region->get_address());
      cold.header    = reinterpret_cast<object_arena_header*>(_cold_region->get_address());
      hot.mru_list   = reinterpret_cast<list_node*>(_hot_mru_region->get_address());
      hot.free_list  = reinterpret_cast<list_node*>(_hot_free_region->get_address());
      cold.free_list = reinterpret_cast<list_node*>(_cold_free_region->get_address());
      cold.big_seg = reinterpret_cast<segment_manager*>(_big_cold_region->get_address());
      hot.big_seg  = reinterpret_cast<segment_manager*>(_big_hot_region->get_address());

      if (init)
      {
         hot.header  = new (hot.header) object_arena_header(hot_file_size);
         cold.header = new (cold.header) object_arena_header(cold_file_size);

         auto init_list = [](list_node* head, uint64_t num_nodes)
         {
            head->next = 0;
            head->prev = 0;

            list_node* pos = head + 1;
            pos->next      = 2;
            pos->prev      = num_nodes - 1;
            for (uint64_t i = 2; i < num_nodes; ++i)
            {
               ++pos;
               pos->next = i + 1;
               pos->prev = i - 1;
            }
            pos->next = 1;
            pos->prev = num_nodes - 2;
         };

         init_list(hot.mru_list, (hot_mru_size / sizeof(list_node)));
         init_list(hot.free_list, (hot_free_size / sizeof(list_node)));
         init_list(cold.free_list, (cold_free_size / sizeof(list_node)));

         hot.big_seg =
             new ((char*)_big_hot_region->get_address()) segment_manager(big_hot_file_size);
         cold.big_seg =
             new ((char*)_big_cold_region->get_address()) segment_manager(big_cold_file_size);
      }
   }

}  // namespace trie

#include <boost/interprocess/file_mapping.hpp>
#include <boost/interprocess/mapped_region.hpp>
#include <boost/interprocess/offset_ptr.hpp>
#include <boost/interprocess/sync/interprocess_sharable_mutex.hpp>
#include <triedent/database.hpp>
#include <triedent/debug.hpp>

namespace triedent
{

   namespace bip = boost::interprocess;
   template <typename T>
   using bip_offset_ptr = bip::offset_ptr<T>;

   database::database(std::filesystem::path dir, access_mode allow_write, bool allow_slow)
   {
      _active_sessions.push_back(&_root_release_session);

      auto db = dir / "db";
      if (not std::filesystem::exists(dir))
         throw std::runtime_error("directory does not exist: '" + dir.generic_string() + "'");

      if (not std::filesystem::exists(db))
         throw std::runtime_error("file does not exist: '" + db.generic_string() + "'");

      auto md = allow_write == read_write ? bip::read_write : bip::read_only;
      _file   = std::make_unique<bip::file_mapping>(db.generic_string().c_str(), md);
      _region = std::make_unique<bip::mapped_region>(*_file, md);

      _dbm = reinterpret_cast<database_memory*>(_region->get_address());

      _ring.reset(new ring_allocator(dir / "data", ring_allocator::read_write, allow_slow));

      _ring->_try_claim_free = [this]() { claim_free(); };
   }

   database::~database() {}

   void database::create(std::filesystem::path dir, config cfg)
   {
      if (std::filesystem::exists(std::filesystem::symlink_status(dir / "db")) ||
          std::filesystem::exists(std::filesystem::symlink_status(dir / "data")))
         throw std::runtime_error("directory already exists: " + dir.generic_string());

      std::filesystem::create_directories(dir);

      auto db = dir / "db";
      {
         std::ofstream f(db.generic_string(), std::ofstream::trunc);
         f.close();
         std::filesystem::resize_file(db, sizeof(database_memory));
      }

      bip::file_mapping  fm(db.generic_string().c_str(), bip::read_write);
      bip::mapped_region mr(fm, bip::read_write);

      new (mr.get_address()) database_memory();

      ring_allocator::create(dir / "data", {.max_ids    = cfg.max_objects,
                                            .hot_pages  = cfg.hot_pages,
                                            .warm_pages = cfg.warm_pages,
                                            .cool_pages = cfg.cool_pages,
                                            .cold_pages = cfg.cold_pages});
   }

   void database::print_stats(bool detail)
   {
      _ring->dump(detail);
   }
}  // namespace triedent

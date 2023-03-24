#include <triedent/database.hpp>
#include <triedent/debug.hpp>

namespace triedent
{
   database::database(const std::filesystem::path& dir,
                      const config&                cfg,
                      access_mode                  mode,
                      bool                         allow_gc)
       : _ring{dir / "data", cfg, mode, allow_gc},
         _file{dir / "db", mode},
         _root_release_session{_ring}
   {
      if (_file.size() == 0)
      {
         _file.resize(sizeof(database_memory));
         new (_file.data())
             database_memory{.magic = file_magic, .flags = file_type_database_root, .top_root = 0};
      }

      if (_file.size() != sizeof(database_memory))
         throw std::runtime_error("Wrong size for file: " + (dir / "db").native());

      _dbm = reinterpret_cast<database_memory*>(_file.data());

      if (_dbm->magic != file_magic)
         throw std::runtime_error("Not a triedent file: " + (dir / "db").native());
      if ((_dbm->flags & file_type_mask) != file_type_database_root)
         throw std::runtime_error("Not a triedent db file: " + (dir / "db").native());
   }

   database::database(const std::filesystem::path& dir, access_mode mode, bool allow_gc)
       : database(dir, config{}, mode, allow_gc)
   {
   }

   database::~database() {}

   void database::create(std::filesystem::path dir, config cfg)
   {
      if (std::filesystem::exists(std::filesystem::symlink_status(dir / "db")) ||
          std::filesystem::exists(std::filesystem::symlink_status(dir / "data")))
         throw std::runtime_error("directory already exists: " + dir.generic_string());

      std::filesystem::create_directories(dir / "data");

      (void)database{dir, cfg, access_mode::read_write};
   }

   void database::print_stats(std::ostream& os, bool detail)
   {
      _ring.print_stats(os, detail);
   }
}  // namespace triedent

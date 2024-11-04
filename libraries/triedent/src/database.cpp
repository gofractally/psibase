#include <triedent/database.hpp>
#include <triedent/debug.hpp>

namespace triedent
{
   namespace
   {
      void create_db_dirs(const std::filesystem::path& dir, open_mode mode)
      {
         if (mode == open_mode::create || mode == open_mode::trunc || mode == open_mode::create_new)
         {
            std::filesystem::create_directories(dir / "data");
         }
      }
   }  // namespace

   database::database(const std::filesystem::path& dir, const config& cfg, open_mode mode)
       : _ring{(create_db_dirs(dir, mode), get_subpath(dir, "data", mode)), cfg, mode},
         _file{get_subpath(dir, "db", mode), mode},
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

   database::database(const std::filesystem::path& dir, open_mode mode)
       : database(dir, config{}, mode)
   {
   }

   database::~database() {}

   void database::create(std::filesystem::path dir, config cfg)
   {
      if (std::filesystem::exists(std::filesystem::symlink_status(dir / "db")) ||
          std::filesystem::exists(std::filesystem::symlink_status(dir / "data")))
         throw std::runtime_error("directory already exists: " + dir.generic_string());

      std::filesystem::create_directories(dir / "data");

      (void)database{dir, cfg, open_mode::create_new};
   }

   void database::print_stats(std::ostream& os, bool detail)
   {
      _ring.print_stats(os, detail);
   }
}  // namespace triedent

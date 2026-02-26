#include <psibase/Mount.hpp>

#include <unistd.h>
#include <filesystem>
#include <fstream>
#include <random>

#include <catch2/catch_all.hpp>
#include <iostream>

using namespace psibase;

struct TempDirectory
{
   TempDirectory() : path(randomName()) { std::filesystem::create_directory(path); }
   ~TempDirectory() { std::filesystem::remove_all(path); }
   static std::filesystem::path randomName()
   {
      constexpr int                              max_tries = 8;
      constexpr int                              len       = 24;
      auto                                       root      = std::filesystem::temp_directory_path();
      std::string_view                           chars     = "abcdefghijklmnopqrstuvwxyz1234567890";
      std::uniform_int_distribution<std::size_t> dist(0, chars.size() - 1);
      std::random_device                         rng;
      for (int i = 0; i < max_tries; ++i)
      {
         std::string name;
         for (int j = 0; j < len; ++j)
         {
            name += chars[dist(rng)];
         }
         auto result = root / name;
         if (!std::filesystem::exists(result))
            return result;
      }
      throw std::runtime_error("Failed to find unused directory name");
   }
   std::filesystem::path path;
};

std::string readFile(const Mount::Fd& fd)
{
   char buf[1000];
   auto sz = ::read(fd.fd, buf, sizeof(buf));
   if (sz < 0)
      throw std::system_error(errno, std::generic_category());
   return std::string(buf, sz);
}

void writeFile(const std::filesystem::path& p, std::string_view value)
{
   std::filesystem::create_directories(p.parent_path());
   std::ofstream stream{p};
   stream << value;
}

TEST_CASE("Direct file")
{
   TempDirectory dir;
   writeFile(dir.path / "one", "1");
   Mount mount;
   mount.mount(dir.path.string(), "/");
   CHECK(readFile(mount.open("/one")) == "1");
}

TEST_CASE("Nested file")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two", "2");
   Mount mount;
   mount.mount(dir.path.string(), "/");
   CHECK(readFile(mount.open("/one/two")) == "2");
}

TEST_CASE("Non-root mount")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two", "2");
   Mount mount;
   mount.mount(dir.path.string(), "/three");
   CHECK(readFile(mount.open("/three/one/two")) == "2");
}

TEST_CASE("Directory symlink")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two", "2");
   std::filesystem::create_directory_symlink("one", dir.path / "three");
   Mount mount;
   mount.mount(dir.path.string(), "/");
   CHECK(readFile(mount.open("/three/two")) == "2");
}

TEST_CASE("File symlink")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two", "2");
   std::filesystem::create_directory(dir.path / "three");
   std::filesystem::create_symlink("../one/two", dir.path / "three" / "four");
   Mount mount;
   mount.mount(dir.path.string(), "/");
   CHECK(readFile(mount.open("/three/four")) == "2");
}

TEST_CASE("Absolute symlink")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two", "2");
   std::filesystem::create_directory_symlink(dir.path, dir.path / "three");
   Mount mount;
   mount.mount(dir.path.string(), "/");
   CHECK(readFile(mount.open("/three/three/three/three/one/two")) == "2");
}

TEST_CASE("Absolute symlink OOB")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two", "2");
   std::filesystem::create_directory_symlink(dir.path, dir.path / "one" / "three");
   Mount mount;
   mount.mount((dir.path / "one").string(), "/one");
   CHECK_THROWS_AS(mount.open("/one/three/one/two"), std::system_error);
}

TEST_CASE("Relative symlink OOB")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two", "2");
   std::filesystem::create_directory_symlink("../one", dir.path / "one" / "three");
   Mount mount;
   mount.mount((dir.path / "one").string(), "/one");
   CHECK_THROWS_AS(mount.open("/one/three/two"), std::system_error);
}

TEST_CASE("Relative symlink ..")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two", "2");
   std::filesystem::create_directory_symlink("../one", dir.path / "one" / "three");
   Mount mount;
   mount.mount(dir.path.string(), "/");
   CHECK(readFile(mount.open("/one/three/two")) == "2");
}

TEST_CASE("Multiple mounts")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two", "2");
   writeFile(dir.path / "three" / "four", "4");
   Mount mount;
   mount.mount((dir.path / "one").string(), "/one");
   mount.mount((dir.path / "three").string(), "/three");
   CHECK(readFile(mount.open("/one/two")) == "2");
   CHECK(readFile(mount.open("/three/four")) == "4");
}

TEST_CASE("Nested mount")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two", "2");
   writeFile(dir.path / "three" / "four", "4");
   Mount mount;
   mount.mount((dir.path / "one").string(), "/");
   mount.mount((dir.path / "three").string(), "/three");
   CHECK(readFile(mount.open("/two")) == "2");
   CHECK(readFile(mount.open("/three/four")) == "4");
}

TEST_CASE("Symlink loop")
{
   TempDirectory dir;
   std::filesystem::create_directory_symlink("loop", dir.path / "loop");
   Mount mount;
   mount.mount(dir.path.string(), "/");
   CHECK_THROWS_AS(mount.open("/loop/one"), std::system_error);
}

TEST_CASE("Absolute symlink in nested mount")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two", "2");
   writeFile(dir.path / "three" / "four", "4");
   std::filesystem::create_directory_symlink(dir.path / "one", dir.path / "link");
   Mount mount;
   SECTION("root first")
   {
      mount.mount(dir.path.string(), "/root");
      mount.mount((dir.path / "one").string(), "/one");
      mount.mount((dir.path / "three").string(), "/one/three");
      CHECK(readFile(mount.open("/root/link/three/four")) == "4");
   }
   SECTION("nested first")
   {
      mount.mount((dir.path / "one").string(), "/one");
      mount.mount((dir.path / "three").string(), "/one/three");
      mount.mount(dir.path.string(), "/root");
      CHECK(readFile(mount.open("/root/link/three/four")) == "4");
   }
}

TEST_CASE("Nested mount with branch")
{
   TempDirectory dir;
   writeFile(dir.path / "one" / "two" / "three" / "four", "4");
   writeFile(dir.path / "five" / "six", "6");
   Mount mount;
   SECTION("root first")
   {
      mount.mount((dir.path / "one").string(), "/");
      mount.mount((dir.path / "five").string(), "/two/three/five");
   }
   SECTION("nested first")
   {
      mount.mount((dir.path / "five").string(), "/two/three/five");
      mount.mount((dir.path / "one").string(), "/");
   }
   CHECK(readFile(mount.open("/two/three/four")) == "4");
   CHECK(readFile(mount.open("/two/three/five/six")) == "6");
}

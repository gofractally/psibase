#pragma once

#include "VmConsensusArtifact.hpp"

#include <cerrno>
#include <chrono>
#include <filesystem>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <stdexcept>
#include <string>
#include <system_error>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>

#ifdef __APPLE__
#include <crt_externs.h>
#include <mach-o/dyld.h>
#else
extern char** environ;
#endif

namespace vm_consensus
{
   inline std::filesystem::path executablePath()
   {
#ifdef __APPLE__
      uint32_t size = 0;
      _NSGetExecutablePath(nullptr, &size);
      std::vector<char> buffer(size);
      if (_NSGetExecutablePath(buffer.data(), &size))
         throw std::runtime_error("cannot find consensus test executable");
      return std::filesystem::canonical(buffer.data());
#else
      return std::filesystem::canonical("/proc/self/exe");
#endif
   }

   // exec gives the saved-only loader a new address space. Its parser type
   // cannot compile/JIT, and the parent keeps the exact artifact alive until
   // the child has exited. Only this owned child may be terminated.
   inline void isolatedSavedReload(const ArtifactFile& artifact, std::string expected)
   {
      std::vector<std::string> environment;
#ifdef __APPLE__
      char** inherited = *_NSGetEnviron();
#else
      char** inherited = ::environ;
#endif
      for (auto item = inherited; *item; ++item)
      {
         std::string value(*item);
         if (value.rfind("PSIBASE_VM_CONSENSUS_CHILD_", 0) != 0)
            environment.push_back(std::move(value));
      }
      environment.push_back("PSIBASE_VM_CONSENSUS_CHILD_ARTIFACT=" + artifact.path.string());
      environment.push_back("PSIBASE_VM_CONSENSUS_CHILD_EXPECTED=" + expected);
      std::vector<char*> env;
      for (auto& item : environment) env.push_back(item.data());
      env.push_back(nullptr);

      auto executable = executablePath().string();
      std::string filter = "VM consensus isolated saved-only child";
      std::string reporter = "--reporter", console = "console";
      char* argv[] = {executable.data(), filter.data(), reporter.data(), console.data(), nullptr};
      auto logfile = artifact.path.parent_path() / "saved-only-child.log";
      int fd = ::open(logfile.c_str(), O_WRONLY | O_CREAT | O_EXCL, 0600);
      if (fd < 0)
         throw std::system_error(errno, std::generic_category(), "saved-only child log");
      posix_spawn_file_actions_t actions;
      int error = posix_spawn_file_actions_init(&actions);
      if (error)
      {
         ::close(fd);
         throw std::system_error(error, std::generic_category(), "saved-only child actions");
      }
      auto cleanup = [&]
      {
         posix_spawn_file_actions_destroy(&actions);
         ::close(fd);
      };
      error = posix_spawn_file_actions_adddup2(&actions, fd, STDOUT_FILENO);
      if (!error) error = posix_spawn_file_actions_adddup2(&actions, fd, STDERR_FILENO);
      if (!error) error = posix_spawn_file_actions_addclose(&actions, fd);
      pid_t child = -1;
      if (!error) error = posix_spawn(&child, executable.c_str(), &actions, nullptr, argv, env.data());
      cleanup();
      if (error)
         throw std::system_error(error, std::generic_category(), "spawn saved-only child");

      int status = 0;
      auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(20);
      while (true)
      {
         auto result = ::waitpid(child, &status, WNOHANG);
         if (result == child) break;
         if (result < 0 && errno != EINTR)
            throw std::system_error(errno, std::generic_category(), "wait saved-only child");
         if (std::chrono::steady_clock::now() >= deadline)
         {
            ::kill(child, SIGKILL);
            while (::waitpid(child, &status, 0) < 0 && errno == EINTR) {}
            throw std::runtime_error("saved-only child exceeded its bounded timeout; see " + logfile.string());
         }
         std::this_thread::sleep_for(std::chrono::milliseconds(10));
      }
      if (!WIFEXITED(status) || WEXITSTATUS(status) != 0)
         throw std::runtime_error("saved-only child failed; see " + logfile.string());
   }
}

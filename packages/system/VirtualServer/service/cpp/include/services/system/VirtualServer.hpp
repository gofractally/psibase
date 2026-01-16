#pragma once

#include <psibase/Memo.hpp>
#include <psibase/Service.hpp>
#include <psibase/psibase.hpp>
#include <psio/fracpack.hpp>
#include <services/user/tokenTypes.hpp>

namespace SystemService
{
   struct ServerSpecs
   {
      uint64_t net_bps;
      uint64_t storage_bytes;
      PSIO_REFLECT(ServerSpecs, net_bps, storage_bytes);
   };

   struct NetworkVariables
   {
      uint8_t  block_replay_factor;
      uint64_t per_block_sys_cpu_ns;
      uint64_t obj_storage_bytes;
      PSIO_REFLECT(NetworkVariables, block_replay_factor, per_block_sys_cpu_ns, obj_storage_bytes);
   };

   struct VirtualServer : public psibase::Service
   {
      static constexpr auto service = psibase::AccountNumber("virtual-server");

      void init();

      /// Initializes the billing system
      ///
      /// If no specs are provided, some default specs are used that define a server
      ///   with minimal specs.
      ///
      /// After calling this action, the billing system is NOT yet enabled. The
      /// `enable_billing` action must be called explicitly to enable user billing.
      void init_billing(psibase::AccountNumber fee_receiver);

      /// Get the account that receives all resource billing fees
      std::optional<psibase::AccountNumber> get_fee_receiver();

      /// Set the virtual server specs
      ///
      /// These are effectively the minimum specs that any node that participates
      /// in the network must have available.
      void set_specs(ServerSpecs specs);

      /// These variables change how the network specs are derived from the server
      /// specs.
      ///
      /// The "network specs" are the specifications of the server as perceived by
      /// a user of the network, which is not the same as the specs needed by each
      /// of the actual nodes. Only a subset of the nodes resources are available for
      /// use by users of the network to account for other overhead and system
      /// functionality.
      void set_network_variables(NetworkVariables variables);

      /// Enable or disable the billing system
      ///
      /// If billing is disabled, resource consumption will still be tracked, but the resources will
      /// not be automatically metered by the network. This is insecure and allows users to abuse
      /// the network by consuming all of the network's resources.
      void enable_billing(bool enabled);

      /// Used to acquire resource tokens for a user.
      ///
      /// The resource tokens are consumed when interacting with metered network functionality.
      ///
      /// The sender must have already credited the system token to this service to pay
      /// for the specified amount of resource tokens. The exchange rate is always 1:1.
      ///
      /// # Arguments
      /// * `amount`   - The amount of resource tokens to buy
      /// * `for_user` - The user to buy the resource tokens for
      /// * `memo`     - A memo for the purchase, only used if the sender is not the resource recipient
      void buy_res_for(UserService::Quantity        amount,
                       psibase::AccountNumber       for_user,
                       std::optional<psibase::Memo> memo);

      /// Used to acquire resource tokens for the sender
      ///
      /// The resource tokens are consumed when interacting with metered network functionality.
      ///
      /// The sender must have already credited the system token to this service to pay
      /// for the specified amount of resource tokens. The exchange rate is always 1:1.
      void buy_res(UserService::Quantity amount);

      /// Allows the sender to request client-side tooling to automatically attempt to
      /// refill their resource buffer when it is at or below the threshold (specified
      /// in integer percentage values).
      ///
      /// A threshold of 0 means that the client should not attempt to refill the
      /// resource buffer.
      void conf_auto_fill(uint8_t threshold_percent);

      /// Allows the sender to specify the capacity of their resource buffer. The larger the
      /// resource buffer, the less often the sender will need to refill it.
      void conf_buffer(uint64_t capacity);

      /// Set the network bandwidth pricing thresholds
      ///
      /// Configures the idle and congested thresholds used by the pricing algorithm
      /// for network bandwidth billing. These thresholds are ppm values representing
      /// the fraction of total available bandwidth (e.g. 45_0000 = 45%, 55_0000 = 55%).
      ///
      /// Below the idle threshold, the price of network bandwidth will decrease.
      /// Above the congested threshold, the price of network bandwidth will increase.
      ///
      /// # Arguments
      /// * `idle_ppm` - Threshold below which the network is considered idle (ppm)
      /// * `congested_ppm` - Threshold above which the network is considered congested (ppm)
      void net_thresholds(uint32_t idle_ppm, uint32_t congested_ppm);

      /// Set the network bandwidth price change rates
      ///
      /// Configures the rate at which the network bandwidth price increases when
      /// congested and decreases when idle.
      ///
      /// # Arguments
      /// * `doubling_time_sec` - Time it takes to double the price when congested
      /// * `halving_time_sec` - Time it takes to halve the price when idle
      void net_rates(uint32_t doubling_time_sec, uint32_t halving_time_sec);

      /// Sets the number of blocks over which to compute the average network usage.
      /// This average usage is compared to the network capacity (every block) to determine
      /// the price of network bandwidth.
      void net_blocks_avg(uint8_t num_blocks);

      /// Sets the size of the billable unit of network bandwidth.
      ///
      /// This unit is also the minimum amount billed for bandwidth in a single transaction.
      void net_min_unit(uint64_t bits);

      /// Set the CPU pricing thresholds
      ///
      /// Configures the idle and congested thresholds used by the pricing algorithm
      /// for CPU billing. These thresholds are ppm values representing
      /// the fraction of total available CPU (e.g. 45_0000 = 45%, 55_0000 = 55%).
      ///
      /// Below the idle threshold, the price of CPU will decrease.
      /// Above the congested threshold, the price of CPU will increase.
      ///
      /// # Arguments
      /// * `idle_ppm` - Threshold below which the network is considered idle (ppm)
      /// * `congested_ppm` - Threshold above which the network is considered congested (ppm)
      void cpu_thresholds(uint32_t idle_ppm, uint32_t congested_ppm);

      /// Set the CPU price change rates
      ///
      /// Configures the rate at which the CPU price increases when
      /// congested and decreases when idle.
      ///
      /// # Arguments
      /// * `doubling_time_sec` - Time it takes to double the price when congested
      /// * `halving_time_sec` - Time it takes to halve the price when idle
      void cpu_rates(uint32_t doubling_time_sec, uint32_t halving_time_sec);

      /// Sets the number of blocks over which to compute the average CPU usage.
      /// This average usage is compared to the network capacity (every block) to determine
      /// the price of CPU.
      void cpu_blocks_avg(uint8_t num_blocks);

      /// Sets the size of the billable unit of CPU time.
      ///
      /// This unit is also the minimum amount billed for CPU in a single transaction.
      void cpu_min_unit(uint64_t ns);

      /// Called by the system to indicate that the specified user has consumed a
      /// given amount of network bandwidth.
      ///
      /// If billing is enabled, the user will be billed for the consumption of
      /// this resource.
      void useNetSys(psibase::AccountNumber user, uint64_t amount_bytes);

      /// Called by the system to indicate that the specified user has consumed a
      /// given amount of CPU.
      ///
      /// If billing is enabled, the user will be billed for the consumption of
      /// this resource.
      void useCpuSys(psibase::AccountNumber user, uint64_t amount_ns);

      UserService::Quantity get_resources(psibase::AccountNumber user);

      void notifyBlock(psibase::BlockNum block_num);

      void initUser(psibase::AccountNumber user);

      /// This actions sets the CPU limit for the specified account.
      /// If the current tx exceeds the limit (ns), then the tx will timeout and fail.
      void setCpuLimit(psibase::AccountNumber account);

      std::optional<psibase::HttpReply> serveSys(psibase::HttpRequest                  request,
                                                 std::optional<std::int32_t>           socket,
                                                 std::optional<psibase::AccountNumber> user);

      struct Events
      {
         struct History
         {
            void consumed(psibase::AccountNumber account,
                          uint8_t                resource,
                          uint64_t               amount,
                          uint64_t               cost);
            void subsidized(psibase::AccountNumber purchaser,
                            psibase::AccountNumber recipient,
                            uint64_t               amount,
                            psibase::Memo          memo);
            void block_summary(psibase::BlockNum block_num,
                               uint32_t          net_usage_ppm,
                               uint32_t          cpu_usage_ppm);
         };
      };
   };

   PSIO_REFLECT(VirtualServer,
                method(init),
                method(init_billing, fee_receiver),
                method(get_fee_receiver),
                method(set_specs, specs),
                method(set_network_variables, variables),
                method(enable_billing, enabled),
                method(buy_res_for, amount, for_user, memo),
                method(buy_res, amount),
                method(conf_auto_fill, threshold_percent),
                method(conf_buffer, capacity),
                method(net_thresholds, idle_ppm, congested_ppm),
                method(net_rates, doubling_time_sec, halving_time_sec),
                method(net_blocks_avg, num_blocks),
                method(net_min_unit, bits),
                method(cpu_thresholds, idle_ppm, congested_ppm),
                method(cpu_rates, doubling_time_sec, halving_time_sec),
                method(cpu_blocks_avg, num_blocks),
                method(cpu_min_unit, ns),
                method(useNetSys, user, amount_bytes),
                method(useCpuSys, user, cpuUsage),
                method(get_resources, user),
                method(notifyBlock, block_num),
                method(initUser, user),
                method(setCpuLimit, account),
                method(serveSys, request, socket, user))

   PSIBASE_REFLECT_EVENTS(VirtualServer);
   PSIBASE_REFLECT_HISTORY_EVENTS(VirtualServer,
                                  method(consumed, account, resource, amount, cost),
                                  method(subsidized, purchaser, recipient, amount, memo),
                                  method(block_summary, block_num, net_usage_ppm, cpu_usage_ppm));

}  // namespace SystemService
#pragma once

#include <psibase/Memo.hpp>
#include <psibase/Rpc.hpp>
#include <psibase/Service.hpp>
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

   struct BufferConfig
   {
      uint8_t  threshold_percent;
      uint64_t capacity;
      PSIO_REFLECT(BufferConfig, threshold_percent, capacity);
   };

   /// Virtual Server Service
   ///
   /// This service defines a "virtual server" that represents the "server" with which
   /// a user interacts when they connect to any full node on the network.
   ///
   /// This service distinguishes between the specs of the network itself, and
   /// the specs of an individual node that runs the virtual server. The actual node
   /// specs must meet or exceed the specs defined for the virtual server. And the
   /// derived network specs will always be less than the virtual server specs to account
   /// for various overheads (e.g. from running a distributed network, desired replay
   /// speed, etc).
   ///
   /// This service also defines a billing system that allows for the network to meter
   /// the consumption of resources by users. A user must send system tokens to this service,
   /// which are then held in reserve for the user.
   ///
   /// As physical resources (CPU, disk space, network bandwidth, etc.) are consumed, the
   /// real-time price of the resource is billed to the user's reserved balance. Reserved system
   /// tokens do not equate to any specific resource amounts, since it's dependent upon the spot
   /// price of the consumed resource at the time of consumption.
   ///
   /// Note that this service is unopinionated about how the user gets the system tokens with
   /// which to pay for the resources. This allows for networks wherein users' system token
   /// balances are distributed manually by a custodian, as well as networks wherein the system
   /// token is distributed by other means (e.g. proof of work, proof of stake, etc.).
   ///
   /// To use:
   /// 1 - Call `init`: Initialize the service. This will derive the network specs using the
   ///     default server specs.
   /// 2 - Call `init_billing`: Initializes the billing system. To call this, the system token
   ///     must have already been set in the `Tokens` service. The specified `fee_receiver` will
   ///     receive all of the system token fees paid for resources by users.
   /// 3 - Call `enable_billing`: When ready (when existing users have accumulated system tokens),
   ///     calling this action will enable the billing system. To call this, the caller must have
   ///     already filled their resource buffer because the action to enable billing is itself billed.
   ///
   /// > Note: typically, step 1 should be called at system boot, and therefore the network should
   /// >       always at least have some server specs and derived network specs.
   ///
   /// After each of the above steps, the billing service will be enabled, and users will be
   /// required to buy resources to transact with the network. Use the other actions in this
   /// service to manage server specs, network variables, and billing parameters, as needed.
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

      /// Returns whether the billing system has been enabled
      bool is_billing_enabled();

      /// Reserves system tokens for future resource consumption by the specified user.
      ///
      /// The reserve is consumed when interacting with metered network functionality.
      ///
      /// The sender must have already credited the system tokens to this service.
      ///
      /// # Arguments
      /// * `amount`   - The amount of systems tokens to reserve
      /// * `for_user` - The user to reserve the system tokens for
      /// * `memo`     - An optional memo to attach to the reservation, only used if the sender is not
      ///                the resource recipient
      void buy_res_for(UserService::Quantity        amount,
                       psibase::AccountNumber       for_user,
                       std::optional<psibase::Memo> memo);

      /// Reserves system tokens for future resource consumption by the specified sub-account.
      ///
      /// The sender must have already credited the system tokens to this service.
      ///
      /// The sender of this action owns the resources in the specified subaccount and is therefore able to specify
      /// it as the billable account for a given transaction at any time.
      ///
      /// # Arguments
      /// * `amount`      - The amount of systems tokens to reserve
      /// * `sub_account` - The sub-account to reserve the system tokens for
      void buy_res_sub(UserService::Quantity amount, std::string sub_account);

      /// Deletes the resource subaccount, returning the resources back to the caller's primary
      /// resource balance.
      void del_res_sub(std::string sub_account);

      /// Gets the amount of resources available for the caller
      UserService::Quantity res_balance();

      /// Gets the amount of resources available for the caller's specified sub-account
      UserService::Quantity res_balance_sub(std::string sub_account);

      /// Reserves system tokens for future resource consumption by the sender
      ///
      /// The reserve is consumed when interacting with metered network functionality.
      ///
      /// The sender must have already credited the system tokens to this service.
      void buy_res(UserService::Quantity amount);

      /// Allows the sender to specify one of their sub-accounts as the billable account for
      /// the current transaction.
      ///
      /// This will only succeed if the sender has already been set by `Transact` to be the
      /// billable account.
      void bill_to_sub(std::string sub_account);

      /// Allows the sender to manage the behavior of client-side tooling with respect to the
      /// automatic management of the sender's resource buffer.
      ///
      /// If `config` is None, the account will use a default configuration
      void conf_buffer(std::optional<BufferConfig> config);

      /// Returns the current cost (in system tokens) of a typically sized resource buffer
      UserService::Quantity std_buffer_cost();

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

      /// Returns the current cost (in system tokens) of consuming the specified amount of network
      /// bandwidth
      UserService::Quantity get_net_cost(uint64_t bytes);

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

      /// Returns the current cost (in system tokens) of consuming the specified amount of
      /// CPU time
      UserService::Quantity get_cpu_cost(uint64_t ns);

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

      /// This action specifies which account is primarily responsible for
      /// paying the bill for any consumed resources.
      ///
      /// A time limit for the execution of the current tx/query will be set based
      /// on the resources available for the specified account.
      void setBillableAcc(psibase::AccountNumber account);

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
                allowHashedMethods(),
                method(init),
                method(init_billing, fee_receiver),
                method(get_fee_receiver),
                method(set_specs, specs),
                method(set_network_variables, variables),
                method(enable_billing, enabled),
                method(is_billing_enabled),
                method(buy_res_for, amount, for_user, memo),
                method(buy_res_sub, amount, sub_account),
                method(del_res_sub, sub_account),
                method(res_balance),
                method(res_balance_sub, sub_account),
                method(buy_res, amount),
                method(bill_to_sub, sub_account),
                method(conf_buffer, config),
                method(std_buffer_cost),
                method(net_thresholds, idle_ppm, congested_ppm),
                method(net_rates, doubling_time_sec, halving_time_sec),
                method(net_blocks_avg, num_blocks),
                method(net_min_unit, bits),
                method(get_net_cost, bytes),
                method(cpu_thresholds, idle_ppm, congested_ppm),
                method(cpu_rates, doubling_time_sec, halving_time_sec),
                method(cpu_blocks_avg, num_blocks),
                method(cpu_min_unit, ns),
                method(get_cpu_cost, ns),
                method(useNetSys, user, amount_bytes),
                method(useCpuSys, user, amount_ns),
                method(get_resources, user),
                method(notifyBlock, block_num),
                method(setBillableAcc, account),
                method(serveSys, request, socket, user))

   PSIBASE_REFLECT_EVENTS(VirtualServer);
   PSIBASE_REFLECT_HISTORY_EVENTS(VirtualServer,
                                  allowHashedMethods(),
                                  method(consumed, account, resource, amount, cost),
                                  method(subsidized, purchaser, recipient, amount, memo),
                                  method(block_summary, block_num, net_usage_ppm, cpu_usage_ppm));

}  // namespace SystemService
import { keccak256, pack } from '@ethersproject/solidity'
import { getReservesAbi } from '@sushiswap/abi'
import { ChainId } from '@sushiswap/chain'
import { Token } from '@sushiswap/currency'
import { Pool, PrismaClient } from '@sushiswap/database'
import { ADDITIONAL_BASES, BASES_TO_CHECK_TRADES_AGAINST } from '@sushiswap/router-config'
import { ConstantProductRPool, RToken } from '@sushiswap/tines'
import { add, getUnixTime } from 'date-fns'
import { BigNumber } from 'ethers'
import { getCreate2Address } from 'ethers/lib/utils'
import { Address, PublicClient } from 'viem'

import {
  filterOnDemandPools,
  getAllPools,
  getOnDemandPools,
  getTopPools,
  PoolResponse,
  PoolResponse2,
} from '../lib/api'
import { ConstantProductPoolCode } from '../pools/ConstantProductPool'
import type { PoolCode } from '../pools/PoolCode'
import { LiquidityProvider, LiquidityProviders } from './LiquidityProvider'
interface PoolInfo {
  poolCode: PoolCode
  validUntilTimestamp: number
}

export abstract class UniswapV2BaseProvider extends LiquidityProvider {
  readonly TOP_POOL_SIZE = 155
  readonly TOP_POOL_LIQUIDITY_THRESHOLD = 5000
  readonly ON_DEMAND_POOL_SIZE = 20
  readonly REFRESH_INITIAL_POOLS_INTERVAL = 60 // SECONDS

  initialPools: Map<string, PoolCode> = new Map()
  poolsByTrade: Map<string, string[]> = new Map()
  onDemandPools: Map<string, PoolInfo> = new Map()
  availablePools: Map<string, PoolResponse2> = new Map()

  blockListener?: () => void
  unwatchBlockNumber?: () => void

  fee = 0.003
  isInitialized = false
  factory: { [chainId: number]: Address } = {}
  initCodeHash: { [chainId: number]: string } = {}
  refreshInitialPoolsTimestamp = getUnixTime(add(Date.now(), { seconds: this.REFRESH_INITIAL_POOLS_INTERVAL }))
  databaseClient: PrismaClient

  constructor(
    chainId: ChainId,
    web3Client: PublicClient,
    databaseClient: PrismaClient,
    factory: { [chainId: number]: Address },
    initCodeHash: { [chainId: number]: string }
  ) {
    super(chainId, web3Client)
    this.factory = factory
    this.initCodeHash = initCodeHash
    if (!(chainId in this.factory) || !(chainId in this.initCodeHash)) {
      throw new Error(`${this.getType()} cannot be instantiated for chainid ${chainId}, no factory or initCodeHash`)
    }
    this.databaseClient = databaseClient
  }

  async initialize() {
    // TODO: retry logic, every X seconds? dont init until the end of the function ideally.
    this.isInitialized = true
    const availablePools = await getAllPools(
      this.databaseClient,
      this.chainId,
      this.getType() === LiquidityProviders.UniswapV2 ? 'Uniswap' : this.getType(),
      this.getType() === LiquidityProviders.SushiSwap ? 'LEGACY' : 'V2',
      ['CONSTANT_PRODUCT_POOL']
    )
    console.debug(`${this.getLogPrefix()} - available: ${availablePools.size}`)

    this.availablePools = availablePools

    // TODO: check if they are sorted? should be.
    const whitelistedPools = Array.from(availablePools.values()).filter((pool) => pool.isWhitelisted)
    const topPools = whitelistedPools.slice(
      0,
      whitelistedPools.length >= this.TOP_POOL_SIZE ? this.TOP_POOL_SIZE : whitelistedPools.length
    )

    if (topPools.length > 0) {
      console.debug(`${this.getLogPrefix()} - INIT: top pools found: ${topPools.length}`)
    } else {
      console.debug(`${this.getLogPrefix()} - INIT: NO pools found.`)
      return []
    }

    const results = await this.client
      .multicall({
        multicallAddress: this.client.chain?.contracts?.multicall3?.address as Address,
        allowFailure: true,
        contracts: topPools.map(
          (pool) =>
            ({
              address: pool.address as Address,
              chainId: this.chainId,
              abi: getReservesAbi,
              functionName: 'getReserves',
            } as const)
        ),
      })
      .catch((e) => {
        console.warn(`${this.getLogPrefix()} - INIT: multicall failed, message: ${e.message}`)
        return undefined
      })

    topPools.forEach((pool, i) => {
      const res0 = results?.[i]?.result?.[0]
      const res1 = results?.[i]?.result?.[1]

      if (res0 && res1) {
        const token0 = new Token({
          chainId: this.chainId,
          address: pool.token0.address,
          decimals: pool.token0.decimals,
          symbol: pool.token0.symbol,
          name: pool.token0.name,
        }) as RToken
        const token1 = new Token({
          chainId: this.chainId,
          address: pool.token1.address,
          decimals: pool.token1.decimals,
          symbol: pool.token1.symbol,
          name: pool.token1.name,
        }) as RToken
        const rPool = new ConstantProductRPool(
          pool.address,
          token0,
          token1,
          this.fee,
          BigNumber.from(res0),
          BigNumber.from(res1)
        )
        const pc = new ConstantProductPoolCode(rPool, this.getType(), this.getPoolProviderName())
        this.initialPools.set(pool.address, pc)
      } else {
        console.error(`${this.getLogPrefix()} - ERROR INIT SYNC, Failed to fetch reserves for pool: ${pool.address}`)
      }
    })

    console.debug(`${this.getLogPrefix()} - INIT, WATCHING ${this.initialPools.size} POOLS`)
  }

  private async getInitialPools(): Promise<PoolResponse[]> {
    // const initialPools = await getAllPools(
    //   this.databaseClient,
    //   this.chainId,
    //   this.getType() === LiquidityProviders.UniswapV2 ? 'Uniswap' : this.getType(),
    //   this.getType() === LiquidityProviders.SushiSwap ? 'LEGACY' : 'V2',
    //   ['CONSTANT_PRODUCT_POOL']
    // )

    // Put in memory, filter client side, create top pools. Keep the rest as poolsAvailable
    return []
    // const topPools = await getTopPools(
    //   this.databaseClient,
    //   this.chainId,
    //   this.getType() === LiquidityProviders.UniswapV2 ? 'Uniswap' : this.getType(),
    //   this.getType() === LiquidityProviders.SushiSwap ? 'LEGACY' : 'V2',
    //   ['CONSTANT_PRODUCT_POOL'],
    //   this.TOP_POOL_SIZE,
    //   this.TOP_POOL_LIQUIDITY_THRESHOLD
    // )

    // return Array.from(topPools.values())
  }

  async getOnDemandPools(t0: Token, t1: Token): Promise<void> {
    const topPoolAddresses = Array.from(this.initialPools.keys())
    const pools = filterOnDemandPools(
      Array.from(this.availablePools.values()),
      t0.address,
      t1.address,
      topPoolAddresses,
      this.ON_DEMAND_POOL_SIZE
    ).filter((pool) => !this.onDemandPools.has(pool.address) || this.initialPools.has(pool.address))

    const validUntilTimestamp = getUnixTime(add(Date.now(), { seconds: this.ON_DEMAND_POOLS_LIFETIME_IN_SECONDS }))

    let created = 0
    let updated = 0
    pools.forEach((pool) => {
      const existingPool = this.onDemandPools.get(pool.address)
      if (existingPool === undefined) {
 
        const token0 = new Token({
          chainId: this.chainId,
          address: pool.token0.address,
          decimals: pool.token0.decimals,
          symbol: pool.token0.symbol,
          name: pool.token0.name,
        }) as RToken
        const token1 = new Token({
          chainId: this.chainId,
          address: pool.token1.address,
          decimals: pool.token1.decimals,
          symbol: pool.token1.symbol,
          name: pool.token1.name,
        }) as RToken
        const rPool = new ConstantProductRPool(
          pool.address,
          token0, 
          token1,
          this.fee,
          BigNumber.from(0),
          BigNumber.from(0)
        )

        const pc = new ConstantProductPoolCode(rPool, this.getType(), this.getPoolProviderName())
        this.onDemandPools.set(pool.address, { poolCode: pc, validUntilTimestamp })
        ++created
      } else {
        existingPool.validUntilTimestamp = validUntilTimestamp
        ++updated
      }
    })
    console.debug(
      `${this.getLogPrefix()} - ON DEMAND: Created ${created} pools, extended 'lifetime' for ${updated} pools`
    )
  }

  async updatePools() {
    if (this.isInitialized) {
      this.removeStalePools()
      this.refreshInitialPools()

      const initialPools = Array.from(this.initialPools.values())
      const onDemandPools = Array.from(this.onDemandPools.values()).map((pi) => pi.poolCode)

      if (initialPools.length === 0 && onDemandPools.length === 0) {
        return
      }

      const [initialPoolsReserves, onDemandPoolsReserves] = await Promise.all([
        this.client
          .multicall({
            multicallAddress: this.client.chain?.contracts?.multicall3?.address as Address,
            allowFailure: true,
            contracts: initialPools.map(
              (poolCode) =>
                ({
                  address: poolCode.pool.address as Address,
                  chainId: this.chainId,
                  abi: getReservesAbi,
                  functionName: 'getReserves',
                } as const)
            ),
          })
          .catch((e) => {
            console.warn(`${this.getLogPrefix()} - UPDATE: initPools multicall failed, message: ${e.message}`)
            return undefined
          }),
        this.client
          .multicall({
            multicallAddress: this.client.chain?.contracts?.multicall3?.address as Address,
            allowFailure: true,
            contracts: onDemandPools.map(
              (poolCode) =>
                ({
                  address: poolCode.pool.address as Address,
                  chainId: this.chainId,
                  abi: getReservesAbi,
                  functionName: 'getReserves',
                } as const)
            ),
          })
          .catch((e) => {
            console.warn(`${this.getLogPrefix()} - UPDATE: on-demand pools multicall failed, message: ${e.message}`)
            return undefined
          }),
      ])

      this.updatePoolWithReserves(initialPools, initialPoolsReserves, 'INITIAL')
      this.updatePoolWithReserves(onDemandPools, onDemandPoolsReserves, 'ON_DEMAND')
    }
  }

  private async refreshInitialPools() {
    if (this.refreshInitialPoolsTimestamp > getUnixTime(Date.now())) {
      return
    }

    this.refreshInitialPoolsTimestamp = getUnixTime(add(Date.now(), { seconds: this.REFRESH_INITIAL_POOLS_INTERVAL }))

    // const freshInitPools = await this.getInitialPools()
    // // TODO: ideally this should remove pools which are no longer included too, but since the list shouldn't change much,
    // // we can keep them in memory and they will disappear the next time the server is restarted
    // const poolsToAdd = freshInitPools.filter((pool) => !this.initialPools.has(pool.address))
    // poolsToAdd.forEach((pool) => {
    //   const rPool = new ConstantProductRPool(
    //     pool.address,
    //     pool.token0 as RToken,
    //     pool.token1 as RToken,
    //     this.fee,
    //     BigNumber.from(0),
    //     BigNumber.from(0)
    //   )
    //   const pc = new ConstantProductPoolCode(rPool, this.getType(), this.getPoolProviderName())
    //   this.initialPools.set(pool.address, pc)
    //   console.log(
    //     `${this.getLogPrefix()} - REFRESH INITIAL POOLS: Added pool ${pool.address} (${pool.token0.symbol}/${
    //       pool.token1.symbol
    //     })`
    //   )
    // })

    console.debug(
      `* MEM ${this.getLogPrefix()} INIT COUNT: ${this.initialPools.size} ON DEMAND COUNT: ${this.onDemandPools.size}`
    )
  }

  private updatePoolWithReserves(
    pools: PoolCode[],
    reserves:
      | (
          | { error: Error; result?: undefined; status: 'error' }
          | { error?: undefined; result: readonly [bigint, bigint, number]; status: 'success' }
        )[]
      | undefined,
    type: 'INITIAL' | 'ON_DEMAND'
  ) {
    if (!reserves) return
    pools.forEach((poolCode, i) => {
      const pool = poolCode.pool
      const res0 = reserves?.[i]?.result?.[0]
      const res1 = reserves?.[i]?.result?.[1]

      if (res0 && res1) {
        const res0BN = BigNumber.from(res0)
        const res1BN = BigNumber.from(res1)
        if (!pool.reserve0.eq(res0BN) || !pool.reserve1.eq(res1BN)) {
          pool.updateReserves(res0BN, res1BN)
          console.info(
            `${this.getLogPrefix()} - SYNC, ${type}: ${pool.address} ${pool.token0.symbol}/${
              pool.token1.symbol
            } ${res0BN.toString()} ${res1BN.toString()}`
          )
        }
      } else {
        console.error(
          `${this.getLogPrefix()} - ERROR UPDATING RESERVES for a ${type} pool, Failed to fetch reserves for pool: ${
            pool.address
          }`
        )
      }
    })
  }

  _getPoolAddress(t1: Token, t2: Token): string {
    return getCreate2Address(
      this.factory[this.chainId as keyof typeof this.factory],
      keccak256(['bytes'], [pack(['address', 'address'], [t1.address, t2.address])]),
      this.initCodeHash[this.chainId as keyof typeof this.initCodeHash]
    )
  }

  // TODO: Decide if this is worth keeping as fallback in case fetching top pools fails? only used on initial load.
  _getProspectiveTokens(t0: Token, t1: Token) {
    const set = new Set<Token>([
      t0,
      t1,
      ...BASES_TO_CHECK_TRADES_AGAINST[this.chainId],
      ...(ADDITIONAL_BASES[this.chainId][t0.address] || []),
      ...(ADDITIONAL_BASES[this.chainId][t1.address] || []),
    ])
    return Array.from(set)
  }

  startFetchPoolsData() {
    this.stopFetchPoolsData()
    this.initialPools = new Map()
    this.unwatchBlockNumber = this.client.watchBlockNumber({
      onBlockNumber: (blockNumber) => {
        this.lastUpdateBlock = Number(blockNumber)
        if (!this.isInitialized) {
          this.initialize()
        } else {
          this.updatePools()
        }
      },
      onError: (error) => {
        console.error(`${this.getLogPrefix()} - Error watching block number: ${error.message}`)
      },
    })
  }

  private removeStalePools() {
    let removed = 0
    const now = getUnixTime(Date.now())
    for (const poolInfo of this.onDemandPools.values()) {
      if (poolInfo.validUntilTimestamp < now) {
        this.onDemandPools.delete(poolInfo.poolCode.pool.address)
        removed++
      }
    }
    if (removed > 0) {
      console.log(`${this.getLogPrefix()} STALE: Removed ${removed} stale pools`)
    }
  }

  async fetchPoolsForToken(t0: Token, t1: Token): Promise<void> {
    await this.getOnDemandPools(t0, t1)
  }

  /**
   * The pools returned are the initial pools, plus any on demand pools that have been fetched for the two tokens.
   * @param t0
   * @param t1
   * @returns
   */
  getCurrentPoolList(t0: Token, t1: Token): PoolCode[] {
    const tradeId = this.getTradeId(t0, t1)
    const poolsByTrade = this.poolsByTrade.get(tradeId) ?? []
    const onDemandPoolCodes = poolsByTrade
      ? Array.from(this.onDemandPools)
          .filter(([poolAddress]) => poolsByTrade.includes(poolAddress))
          .map(([, p]) => p.poolCode)
      : []

    return [...this.initialPools.values(), onDemandPoolCodes].flat()
  }

  stopFetchPoolsData() {
    if (this.unwatchBlockNumber) this.unwatchBlockNumber()
    this.blockListener = undefined
  }
}

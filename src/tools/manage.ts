import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Keypair, VersionedTransaction } from '@solana/web3.js'
import type { LavaApiClient } from '../api-client.js'
import type { TradingMode } from '../session.js'
import { getPrivyClient, type ServerConfig } from '../server.js'

export function registerManageTools(
  server: McpServer,
  getClient: () => LavaApiClient,
  getWallet: () => string,
  getMode: () => TradingMode | null,
  config: ServerConfig,
  getLocalKeypair?: () => Keypair | null,
) {
  server.tool(
    'lavarage_partial_sell',
    `Sell a portion of a position (take partial profit). Specify what percentage to sell.

This is a two-step operation: split the position, then close the split portion.

In "unsigned" mode: returns both unsigned transactions (split + close). Submit them sequentially — split first, then close.
In "server-wallet" mode: signs and submits both transactions sequentially.

If the close step fails after the split succeeds, you will have two separate positions (the original reduced portion and the split portion). This is safe — no funds are lost. Simply call lavarage_close_position on the split portion to complete the sale, or keep it as a separate position.`,
    {
      positionAddress: z.string().describe('The position account address (base58)'),
      sellPercent: z.number().min(1).max(99).describe('Percentage of position to sell (e.g. 50 = sell half)'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps'),
    },
    async ({ positionAddress, sellPercent, slippageBps }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const result = await client.buildPartialSellTx({
          positionAddress,
          userPublicKey: wallet,
          splitRatioBps: sellPercent * 100,
          slippageBps,
        })

        if (mode === 'unsigned') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                mode: 'unsigned',
                splitTransaction: result.splitTransaction,
                closeTransaction: result.closeTransaction,
                newPositionAddresses: result.newPositionAddresses,
                message: `Partial sell transactions built (${sellPercent}%). Sign both transactions and submit as a Jito bundle.`,
              }, null, 2),
            }],
          }
        }

        // Sign all TXs (Privy or local keypair), submit as Jito bundle
        const bs58mod = await import('bs58')

        // Build tip TX
        const { Connection, PublicKey: PK, SystemProgram, TransactionMessage, VersionedTransaction: VTX } = await import('@solana/web3.js')
        const conn = new Connection(config.solanaRpcUrl)
        const { tipLamports } = await client.getTipFloor()
        const { blockhash } = await conn.getLatestBlockhash('confirmed')

        const tipAccounts = [
          'astrazznxsGUhWShqgNtAdfrzP2G83DzcWVJDxwV9bF',
          'astra4uejePWneqNaJKuFFA8oonqCE1sqF6b45kDMZm',
        ]
        const tipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)]
        const tipMsg = new TransactionMessage({
          payerKey: new PK(wallet),
          recentBlockhash: blockhash,
          instructions: [SystemProgram.transfer({ fromPubkey: new PK(wallet), toPubkey: new PK(tipAccount), lamports: tipLamports })],
        }).compileToV0Message()
        const tipTx = new VTX(tipMsg)

        // Deserialize split + close
        const splitTx = VTX.deserialize(bs58mod.default.decode(result.splitTransaction))
        const closeTx = VTX.deserialize(bs58mod.default.decode(result.closeTransaction))

        const toBase64 = (tx: VersionedTransaction) =>
          Buffer.from(tx.serialize()).toString('base64')

        let tipB64: string, splitB64: string, closeB64: string
        if (mode === 'local') {
          const keypair = getLocalKeypair?.()
          if (!keypair) throw new Error('Local mode requires a loaded keypair.')
          tipTx.sign([keypair])
          splitTx.sign([keypair])
          closeTx.sign([keypair])
          tipB64 = toBase64(tipTx)
          splitB64 = toBase64(splitTx)
          closeB64 = toBase64(closeTx)
        } else {
          const privyClient = await getPrivyClient(config)
          const [signedTip, signedSplit, signedClose] = await Promise.all([
            privyClient.walletApi.solana.signTransaction({ address: wallet, chainType: 'solana', transaction: tipTx }),
            privyClient.walletApi.solana.signTransaction({ address: wallet, chainType: 'solana', transaction: splitTx }),
            privyClient.walletApi.solana.signTransaction({ address: wallet, chainType: 'solana', transaction: closeTx }),
          ])
          const extract = (signedResult: any): VersionedTransaction =>
            signedResult.signedTransaction ?? signedResult.transaction ?? signedResult
          tipB64 = toBase64(extract(signedTip))
          splitB64 = toBase64(extract(signedSplit))
          closeB64 = toBase64(extract(signedClose))
        }

        const bundleRes = await client.submitBundle([tipB64, splitB64, closeB64])

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              mode,
              bundleId: bundleRes.result,
              message: `Sold ${sellPercent}% of position via Jito bundle.`,
            }, null, 2),
          }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_repay',
    `Fully repay a borrow position (return borrowed tokens to the lender).

In "unsigned" mode: returns unsigned transaction.
In "server-wallet" mode: signs and submits automatically.`,
    {
      positionAddress: z.string().describe('The borrow position account address (base58)'),
    },
    async ({ positionAddress }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const result = await client.buildRepayTx({
          positionAddress,
          userPublicKey: wallet,
        })

        return handleTxResult(mode, result, 'Repay', wallet, config, getLocalKeypair)
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_partial_repay',
    `Partially repay a borrow position. Specify what percentage to repay.

In "unsigned" mode: returns unsigned transaction.
In "server-wallet" mode: signs and submits automatically.`,
    {
      positionAddress: z.string().describe('The borrow position account address (base58)'),
      repayPercent: z.number().min(1).max(100).describe('Percentage of borrow to repay (e.g. 50 = repay half)'),
    },
    async ({ positionAddress, repayPercent }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const result = await client.buildPartialRepayTx({
          positionAddress,
          userPublicKey: wallet,
          repaymentBps: repayPercent * 100,
        })

        return handleTxResult(mode, result, 'Partial repay', wallet, config, getLocalKeypair)
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_split_position',
    `Split a position into two. The new position gets the specified percentage.

In "unsigned" mode: returns unsigned transaction.
In "server-wallet" mode: signs and submits automatically.`,
    {
      positionAddress: z.string().describe('The position account address (base58)'),
      splitPercent: z.number().min(1).max(99).describe('Percentage for the new position (e.g. 50 = split in half)'),
    },
    async ({ positionAddress, splitPercent }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const result = await client.buildSplitTx({
          positionAddress,
          userPublicKey: wallet,
          splitRatioBps: splitPercent * 100,
        })

        return handleTxResult(mode, result, 'Split', wallet, config, getLocalKeypair)
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_merge_positions',
    `Merge two positions into one. Both must be the same token pair and side.

In "unsigned" mode: returns unsigned transaction.
In "server-wallet" mode: signs and submits automatically.`,
    {
      firstPositionAddress: z.string().describe('First position address (base58)'),
      secondPositionAddress: z.string().describe('Second position address (base58) — merges into first'),
    },
    async ({ firstPositionAddress, secondPositionAddress }) => {
      try {
        const mode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()

        const result = await client.buildMergeTx({
          firstPositionAddress,
          secondPositionAddress,
          userPublicKey: wallet,
        })

        return handleTxResult(mode, result, 'Merge', wallet, config, getLocalKeypair)
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        }
      }
    },
  )

  server.tool(
    'lavarage_increase_borrow',
    `Increase leverage on an existing position. Two modes:

- "withdraw": Borrow more quote tokens (SOL/USDC) and receive them in your wallet. Increases LTV but gives you liquid funds.
- "compound": Borrow more quote tokens AND swap them into the base token, adding to your position size. This is like increasing your leverage — your exposure grows but so does liquidation risk.

Use lavarage_increase_borrow_quote first to see max borrowable and projected LTV.

In "unsigned" mode: returns unsigned transaction.
In "server-wallet" mode: signs and submits automatically.`,
    {
      positionAddress: z.string().describe('The position account address (base58)'),
      additionalBorrowAmount: z.string().describe('Amount to borrow in quote token smallest units (lamports for SOL)'),
      mode: z.enum(['withdraw', 'compound']).describe('"withdraw" = receive tokens, "compound" = swap into more base token'),
      slippageBps: z.number().optional().default(50).describe('Slippage tolerance in bps (compound mode only)'),
    },
    async ({ positionAddress, additionalBorrowAmount, mode: borrowMode, slippageBps }) => {
      try {
        const txMode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()
        const { tipLamports } = await client.getTipFloor()

        const result = await client.buildIncreaseBorrowTx({
          positionAddress,
          userPublicKey: wallet,
          additionalBorrowAmount,
          mode: borrowMode,
          slippageBps,
          astralaneTipLamports: tipLamports,
        })

        return handleTxResult(txMode, result, 'Increase borrow', wallet, config, getLocalKeypair)
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true }
      }
    },
  )

  server.tool(
    'lavarage_increase_borrow_quote',
    `Preview the impact of increasing borrow. Shows max borrowable, current/projected LTV, fee, and swap quote (compound mode).`,
    {
      positionAddress: z.string().describe('The position account address (base58)'),
      mode: z.enum(['withdraw', 'compound']).describe('"withdraw" or "compound"'),
      additionalBorrowAmount: z.string().optional().describe('Amount to borrow (omit to see max borrowable)'),
      slippageBps: z.number().optional().default(50).describe('Slippage in bps (compound only)'),
    },
    async ({ positionAddress, mode: borrowMode, additionalBorrowAmount, slippageBps }) => {
      try {
        const client = getClient()
        const quote = await client.getIncreaseBorrowQuote({
          positionAddress, userPublicKey: client.getWalletAddress(),
          mode: borrowMode, additionalBorrowAmount, slippageBps,
        })
        return { content: [{ type: 'text' as const, text: JSON.stringify(quote, null, 2) }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true }
      }
    },
  )

  server.tool(
    'lavarage_add_collateral',
    `Add more of the traded token (base token) to an existing position. This reduces LTV and moves the liquidation price further away, making the position safer.

IMPORTANT: This adds the BASE token (the token you're long on), NOT the quote token.
For example, on a WBTC/USDC position, you add WBTC (in satoshis). On a cbBTC/SOL position, you add cbBTC.
You must hold the base token in your wallet. Check lavarage_wallet_balance first.

Amount is in the base token's smallest units (e.g. satoshis for BTC tokens, lamports for SOL).

In "unsigned" mode: returns unsigned transaction.
In "server-wallet" mode: signs and submits automatically.`,
    {
      positionAddress: z.string().describe('The position account address (base58)'),
      collateralAmount: z.string().describe('Amount of base token to add, in smallest units (e.g. satoshis for WBTC)'),
    },
    async ({ positionAddress, collateralAmount }) => {
      try {
        const txMode = requireMode(getMode())
        const wallet = getWallet()
        const client = getClient()
        const { tipLamports } = await client.getTipFloor()

        const result = await client.buildAddCollateralTx({
          positionAddress, userPublicKey: wallet, collateralAmount,
          astralaneTipLamports: tipLamports,
        })

        return handleTxResult(txMode, result, 'Add collateral', wallet, config, getLocalKeypair)
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true }
      }
    },
  )

  server.tool(
    'lavarage_add_collateral_quote',
    `Preview the impact of adding base token to a position. Shows current and projected LTV after adding the specified amount.

Amount is in the base token's smallest units (e.g. satoshis for BTC, lamports for SOL).`,
    {
      positionAddress: z.string().describe('The position account address (base58)'),
      collateralAmount: z.string().describe('Amount of base token to add, in smallest units'),
    },
    async ({ positionAddress, collateralAmount }) => {
      try {
        const client = getClient()
        const quote = await client.getAddCollateralQuote({
          positionAddress, userPublicKey: client.getWalletAddress(), collateralAmount,
        })
        return { content: [{ type: 'text' as const, text: JSON.stringify(quote, null, 2) }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: formatError(err) }], isError: true }
      }
    },
  )
}

function requireMode(mode: TradingMode | null): TradingMode {
  if (!mode) {
    throw new Error('Trading mode not set. Call lavarage_setup first.')
  }
  return mode
}

async function handleTxResult(
  mode: TradingMode,
  result: any,
  action: string,
  wallet: string,
  config: ServerConfig,
  getLocalKeypair?: () => Keypair | null,
) {
  if (mode === 'unsigned') {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          mode: 'unsigned',
          transaction: result.transaction,
          lastValidBlockHeight: result.lastValidBlockHeight,
          message: `${action} transaction built. Sign and submit.`,
        }, null, 2),
      }],
    }
  }

  const txSig = await submitTransaction(result.transaction, wallet, mode, config, getLocalKeypair)
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        mode,
        signature: txSig,
        message: `${action} complete! TX: ${txSig}`,
      }, null, 2),
    }],
  }
}

async function submitTransaction(
  transactionBase58: string,
  walletAddress: string,
  mode: TradingMode,
  config: ServerConfig,
  getLocalKeypair?: () => Keypair | null,
): Promise<string> {
  if (mode === 'local') {
    const keypair = getLocalKeypair?.()
    if (!keypair) throw new Error('Local mode requires a loaded keypair.')
    return signAndSubmitLocal(transactionBase58, keypair, config.solanaRpcUrl)
  }
  return signAndSubmitViaPrivy(transactionBase58, walletAddress, config)
}

async function signAndSubmitLocal(
  transactionBase58: string,
  keypair: Keypair,
  rpcUrl: string,
): Promise<string> {
  const bs58 = await import('bs58')
  const txBuffer = Buffer.from(bs58.default.decode(transactionBase58))
  const tx = VersionedTransaction.deserialize(txBuffer)
  tx.sign([keypair])

  const { Connection } = await import('@solana/web3.js')
  const conn = new Connection(rpcUrl, 'confirmed')
  return conn.sendRawTransaction(tx.serialize(), { skipPreflight: true })
}

async function signAndSubmitViaPrivy(
  transactionBase58: string,
  walletAddress: string,
  config: ServerConfig,
): Promise<string> {
  if (!config.privySigningKey) {
    throw new Error('Server-wallet mode requires PRIVY_SIGNING_KEY.')
  }

  const privyClient = await getPrivyClient(config)

  const bs58 = await import('bs58')
  const txBuffer = Buffer.from(bs58.default.decode(transactionBase58))
  const tx = VersionedTransaction.deserialize(txBuffer)

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Privy signing timed out after 30s.')), 30_000),
  )

  try {
    const signed = await Promise.race([
      privyClient.walletApi.solana.signTransaction({
        address: walletAddress,
        chainType: 'solana',
        transaction: tx,
      }),
      timeout,
    ])

    const signedTx: VersionedTransaction =
      signed.signedTransaction ?? signed.transaction ?? signed
    const rawBytes =
      signedTx instanceof Uint8Array ? signedTx : signedTx.serialize()

    const { Connection } = await import('@solana/web3.js')
    const conn = new Connection(config.solanaRpcUrl, 'confirmed')
    const signature = await conn.sendRawTransaction(rawBytes, {
      skipPreflight: true,
    })
    return signature
  } catch (err: any) {
    console.error(`Privy sign error for ${walletAddress}:`, err.message ?? err)
    throw err
  }
}

function formatError(err: any): string {
  if (err.code && err.message) {
    return `API Error [${err.code}]: ${err.message}${err.detail ? ` — ${err.detail}` : ''}`
  }
  return `Error: ${err.message ?? String(err)}`
}

export interface ApiError {
  statusCode: number
  code: string
  message: string
  detail?: string
}

export class LavaApiClient {
  constructor(
    private apiUrl: string,
    private apiKey: string,
    private wallet: string,
  ) {}

  setWallet(wallet: string) {
    this.wallet = wallet
  }

  // --- Positions ---

  async getPositions(status?: string): Promise<any[]> {
    const params = new URLSearchParams({ owner: this.wallet })
    if (status && status !== 'ALL') params.set('status', status)
    return this.get(`/api/v1/positions?${params}`)
  }

  getWalletAddress(): string {
    return this.wallet
  }

  async getPosition(address: string): Promise<any> {
    // Fetch all positions for this wallet and filter by address
    // TODO: Add a /positions/:address endpoint to the backend for direct lookup
    const positions = await this.get(
      `/api/v1/positions?owner=${this.wallet}&limit=250`,
    )
    const match = Array.isArray(positions)
      ? positions.find((p: any) => p.address === address)
      : null
    if (!match) {
      const err: ApiError = { statusCode: 404, code: 'POSITION_NOT_FOUND', message: `Position ${address} not found for wallet ${this.wallet}` }
      throw err
    }
    return match
  }

  // --- Tokens ---

  async getTokens(search?: string): Promise<any[]> {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    const qs = params.toString()
    return this.get(`/api/v1/tokens${qs ? `?${qs}` : ''}`)
  }

  // --- Offers / Rates ---

  async getOffers(tags?: string): Promise<any[]> {
    const params = new URLSearchParams({ includeTokens: 'true' })
    if (tags) params.set('tags', tags)
    return this.get(`/api/v1/offers?${params}`)
  }

  // --- Quotes ---

  async getOpenQuote(dto: {
    offerPublicKey: string
    userPublicKey: string
    collateralAmount: string
    leverage: number
    slippageBps?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/quote', dto)
  }

  // --- Trade History ---

  async getTradeHistory(opts?: {
    positionAddress?: string
    eventType?: string
    limit?: number
    offset?: number
  }): Promise<any> {
    const params = new URLSearchParams({ owner: this.wallet })
    if (opts?.positionAddress) params.set('positionAddress', opts.positionAddress)
    if (opts?.eventType) params.set('eventType', opts.eventType)
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.offset) params.set('offset', String(opts.offset))
    return this.get(`/api/v1/positions/trade-history?${params}`)
  }

  // --- Orders (TP/SL) ---
  // Orders require wallet signature headers in addition to API key

  async createOrder(dto: {
    positionAddress: string
    walletId: string
    userPublicKey: string
    orderType: 'TAKE_PROFIT' | 'STOP_LOSS'
    triggerPrice: string
    side: 'LONG' | 'SHORT'
  }, walletSigHeaders?: Record<string, string>): Promise<any> {
    return this.request('/api/v1/orders', {
      method: 'POST',
      body: JSON.stringify(dto),
      headers: walletSigHeaders,
    })
  }

  async getOrders(positionAddress?: string): Promise<any[]> {
    const params = new URLSearchParams({ owner: this.wallet })
    if (positionAddress) params.set('positionAddress', positionAddress)
    return this.get(`/api/v1/orders?${params}`)
  }

  async cancelOrder(orderId: string, walletSigHeaders?: Record<string, string>): Promise<any> {
    return this.request(`/api/v1/orders/${orderId}`, {
      method: 'DELETE',
      headers: walletSigHeaders,
    })
  }

  // --- Quotes ---

  async getCloseQuote(dto: {
    positionAddress: string
    userPublicKey: string
    slippageBps?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/close-quote', dto)
  }

  // --- Transaction Builders ---

  async buildOpenTx(dto: {
    offerPublicKey: string
    userPublicKey: string
    collateralAmount: string
    leverage: number
    slippageBps?: number
    astralaneTipLamports?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/open', dto)
  }

  async buildCloseTx(dto: {
    positionAddress: string
    userPublicKey: string
    slippageBps?: number
    astralaneTipLamports?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/close', dto)
  }

  async buildRepayTx(dto: {
    positionAddress: string
    userPublicKey: string
  }): Promise<any> {
    return this.post('/api/v1/positions/repay', dto)
  }

  async buildPartialRepayTx(dto: {
    positionAddress: string
    userPublicKey: string
    repaymentBps: number
  }): Promise<any> {
    return this.post('/api/v1/positions/partial-repay', dto)
  }

  async buildSplitTx(dto: {
    positionAddress: string
    userPublicKey: string
    splitRatioBps: number
  }): Promise<any> {
    return this.post('/api/v1/positions/split', dto)
  }

  async buildMergeTx(dto: {
    firstPositionAddress: string
    secondPositionAddress: string
    userPublicKey: string
  }): Promise<any> {
    return this.post('/api/v1/positions/merge', dto)
  }

  async buildPartialSellTx(dto: {
    positionAddress: string
    userPublicKey: string
    splitRatioBps: number
    slippageBps?: number
  }): Promise<any> {
    return this.post('/api/v1/positions/partial-sell', dto)
  }

  // --- Bundle Submission ---

  async submitTransaction(transaction: string, mevProtect = true): Promise<any> {
    return this.post('/api/v1/bundle/submit', { transaction, mevProtect })
  }

  async getTipFloor(): Promise<{ tipLamports: number }> {
    return this.get('/api/v1/bundle/tip')
  }

  // --- HTTP ---

  private async get(path: string): Promise<any> {
    return this.request(path, { method: 'GET' })
  }

  private async post(path: string, body: unknown): Promise<any> {
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  private async request(path: string, init: RequestInit): Promise<any> {
    const url = `${this.apiUrl}${path}`
    const res = await fetch(url, {
      ...init,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      const err: ApiError = {
        statusCode: res.status,
        code: data?.code ?? 'UNKNOWN_ERROR',
        message: data?.message ?? `API returned ${res.status}`,
        detail: data?.detail,
      }
      throw err
    }

    return data
  }
}

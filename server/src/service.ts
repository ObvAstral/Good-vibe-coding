import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import { tokenAbi } from "@riciclo/shared/abi";
import {
  cartHash,
  json,
  purchaseDomain,
  purchaseTypes,
  type Deployment,
  type DepositResult,
  type Point,
  type Quote,
} from "@riciclo/shared";

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface DepositInput {
  recipient: Address;
  machineId: string;
  bottles: number;
  requestId: string;
}
export interface CartItem {
  productId: string;
  quantity: number;
}
export interface ServiceOptions {
  deployment: Deployment;
  rpcUrl: string;
  publicRpcUrl: string;
  databasePath: string;
  operators: LocalAccount[];
}
interface Row {
  request_id: string;
  payload: string;
  raw_tx: Hex | null;
  tx_hash: Hex | null;
  tx_nonce: number | null;
  operator: string | null;
  status: DepositResult["status"];
  error: string | null;
}
function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
export class TerminalService {
  readonly client;
  readonly chain;
  readonly db: Database.Database;
  readonly contract;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(readonly options: ServiceOptions) {
    this.client = createPublicClient({
      transport: http(options.rpcUrl, { timeout: 8000, retryCount: 0 }),
    });
    this.chain = defineChain({
      id: options.deployment.chainId,
      name: "Riciclo Solidale",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [options.rpcUrl] } },
    });
    this.contract = {
      address: options.deployment.contractAddress,
      abi: tokenAbi,
    };
    if (options.databasePath !== ":memory:")
      mkdirSync(dirname(options.databasePath), { recursive: true });
    this.db = new Database(options.databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deposits (
        request_id TEXT PRIMARY KEY,payload TEXT NOT NULL,raw_tx TEXT,tx_hash TEXT,
        tx_nonce INTEGER,operator TEXT,status TEXT NOT NULL,error TEXT
      );`);
    const identity = json([
      options.deployment.chainId,
      options.deployment.contractAddress.toLowerCase(),
      options.deployment.deploymentBlockHash,
    ]);
    const current = this.db
      .prepare("SELECT value FROM metadata WHERE key=?")
      .get("deployment") as { value: string } | undefined;
    if (current && current.value !== identity) {
      this.db.close();
      throw new Error(
        "Database associato a un altro deployment. Usare un nuovo DATABASE_PATH o il reset locale.",
      );
    }
    this.db
      .prepare("INSERT OR IGNORE INTO metadata VALUES (?,?)")
      .run("deployment", identity);
  }
  async validateDeployment() {
    if ((await this.client.getChainId()) !== this.options.deployment.chainId)
      throw new Error("RPC e manifest hanno chainId differenti.");
    const block = await this.client.getBlock({
      blockNumber: BigInt(this.options.deployment.deploymentBlock),
    });
    if (block.hash !== this.options.deployment.deploymentBlockHash)
      throw new Error(
        "La rete è stata resettata: rigenerare manifest e stato locale.",
      );
    if (!(await this.client.getCode({ address: this.contract.address })))
      throw new Error("Contratto non presente.");
    const points = await this.client.readContract({
      ...this.contract,
      functionName: "getPoints",
    });
    for (const p of points.filter((p) => p.active))
      if (!this.account(p.operator))
        throw new Error(`Chiave operatore mancante per il punto ${p.id}.`);
  }
  private account(address: Address) {
    return this.options.operators.find(
      (a) => a.address.toLowerCase() === address.toLowerCase(),
    );
  }
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Servizio chiuso."));
    const pending = this.queue.then(task, task);
    this.queue = pending.catch(() => {});
    return pending;
  }
  private row(id: string) {
    return this.db
      .prepare("SELECT * FROM deposits WHERE request_id=?")
      .get(id) as Row | undefined;
  }
  private result(row: Row): DepositResult {
    return {
      requestId: row.request_id,
      txHash: row.tx_hash,
      status: row.status,
      ...(row.error ? { error: row.error } : {}),
    };
  }
  private async point(id: string, kind: 0 | 1) {
    const p = await this.client
      .readContract({ ...this.contract, functionName: "getPoints" })
      .then((points) => points.find((p) => p.id === BigInt(id)));
    if (!p || !p.active || p.kind !== kind)
      fail(
        422,
        "PointUnavailable",
        "Punto inesistente, inattivo o di tipo errato.",
      );
    const account = this.account(p.operator);
    if (!account)
      fail(
        503,
        "OperatorUnavailable",
        "Operatore non configurato: aggiornare le chiavi del backend.",
      );
    return { point: p, account };
  }
  async config() {
    const points = await this.client.readContract({
      ...this.contract,
      functionName: "getPoints",
    });
    return {
      deployment: this.options.deployment,
      rpcUrl: this.options.publicRpcUrl,
      points: points.map((p) => ({
        ...p,
        id: p.id.toString(),
        name:
          this.options.deployment.points.find(
            (meta) => meta.id === p.id.toString(),
          )?.name ?? `Punto ${p.id}`,
      })) satisfies Point[],
    };
  }
  async deposit(input: DepositInput) {
    const normalized = {
      recipient: getAddress(input.recipient).toLowerCase(),
      machineId: BigInt(input.machineId).toString(),
      bottles: input.bottles,
      requestId: input.requestId.toLowerCase(),
    };
    const payload = json(normalized);
    return this.exclusive(async () => {
      const existing = this.row(normalized.requestId);
      if (existing && existing.payload !== payload)
        fail(
          409,
          "RequestConflict",
          "requestId già utilizzato con un payload diverso.",
        );
      this.db
        .prepare(
          "INSERT OR IGNORE INTO deposits(request_id,payload,status) VALUES(?,?,'prepared')",
        )
        .run(normalized.requestId, payload);
      const row = await this.process(normalized.requestId);
      return this.result(row);
    });
  }
  async depositStatus(id: string) {
    return this.exclusive(async () => {
      if (!this.row(id.toLowerCase()))
        fail(404, "NotFound", "Deposito non trovato.");
      return this.result(await this.process(id.toLowerCase()));
    });
  }
  private async process(id: string): Promise<Row> {
    let row = this.row(id)!;
    if (row.status === "confirmed" || row.status === "failed") return row;
    try {
      if (!row.raw_tx) {
        const input = JSON.parse(row.payload) as DepositInput;
        const { account } = await this.point(input.machineId, 0);
        const networkNonce = await this.client.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        });
        const reserved = this.db
          .prepare(
            "SELECT MAX(tx_nonce) AS n FROM deposits WHERE operator=? AND raw_tx IS NOT NULL AND status IN ('prepared','pending')",
          )
          .get(account.address.toLowerCase()) as { n: number | null };
        const nonce = Math.max(networkNonce, (reserved.n ?? -1) + 1);
        const depositId = keccak256(`0x${id.replaceAll("-", "")}`);
        const data = encodeFunctionData({
          abi: tokenAbi,
          functionName: "deposit",
          args: [
            BigInt(input.machineId),
            getAddress(input.recipient),
            BigInt(input.bottles),
            depositId,
          ],
        });
        const wallet = createWalletClient({
          account,
          chain: this.chain,
          transport: http(this.options.rpcUrl, {
            timeout: 8000,
            retryCount: 0,
          }),
        });
        const request = await wallet.prepareTransactionRequest({
          to: this.contract.address,
          data,
          nonce,
        });
        const raw = await wallet.signTransaction(request);
        // Persist the signed bytes BEFORE sending: a crash can only rebroadcast the same hash.
        this.db
          .prepare(
            "UPDATE deposits SET raw_tx=?,tx_hash=?,tx_nonce=?,operator=? WHERE request_id=?",
          )
          .run(raw, keccak256(raw), nonce, account.address.toLowerCase(), id);
        row = this.row(id)!;
      }
      try {
        const receipt = await this.client.getTransactionReceipt({
          hash: row.tx_hash!,
        });
        this.db
          .prepare("UPDATE deposits SET status=?,error=? WHERE request_id=?")
          .run(
            receipt.status === "success" ? "confirmed" : "failed",
            receipt.status === "success"
              ? null
              : "Transazione rifiutata dal contratto.",
            id,
          );
        return this.row(id)!;
      } catch (error) {
        if (!(error instanceof TransactionReceiptNotFoundError)) throw error;
      }
      await this.client.sendRawTransaction({
        serializedTransaction: row.raw_tx!,
      });
      this.db
        .prepare(
          "UPDATE deposits SET status='pending',error=NULL WHERE request_id=?",
        )
        .run(id);
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 422) {
        this.db
          .prepare(
            "UPDATE deposits SET status='failed',error=? WHERE request_id=?",
          )
          .run(error.message, id);
      } else {
        // RPC timeouts are ambiguous; never create a replacement transaction.
        this.db
          .prepare("UPDATE deposits SET error=? WHERE request_id=?")
          .run(
            "RPC o operatore non disponibile. Recupero automatico della stessa richiesta.",
            id,
          );
      }
    }
    return this.row(id)!;
  }
  async recover() {
    return this.exclusive(async () => {
      const rows = this.db
        .prepare(
          "SELECT request_id FROM deposits WHERE status IN ('prepared','pending') ORDER BY rowid",
        )
        .all() as { request_id: string }[];
      for (const row of rows) await this.process(row.request_id);
    });
  }
  async quote(
    buyer: Address,
    storeId: string,
    cart: CartItem[],
  ): Promise<Quote> {
    const canonical = cart
      .map((item) => ({
        id: BigInt(item.productId),
        quantity: BigInt(item.quantity),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (canonical.some((item, i) => i > 0 && canonical[i - 1].id === item.id))
      fail(400, "InvalidCart", "Il carrello contiene prodotti duplicati.");
    const { account } = await this.point(storeId, 1);
    const ids = canonical.map((item) => item.id),
      quantities = canonical.map((item) => item.quantity);
    let maxTotal: bigint;
    try {
      maxTotal = await this.client.readContract({
        ...this.contract,
        functionName: "quoteCart",
        args: [ids, quantities],
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /InvalidCart|InvalidQuantity/.test(error.message)
      )
        fail(400, "InvalidCart", "Carrello non valido.");
      throw error;
    }
    const address = getAddress(buyer);
    let nonce: bigint;
    do {
      nonce = BigInt(`0x${randomBytes(32).toString("hex")}`);
    } while (
      await this.client.readContract({
        ...this.contract,
        functionName: "usedPurchaseNonces",
        args: [address, nonce],
      })
    );
    const deadline = (await this.client.getBlock()).timestamp + 300n;
    const signature = await account.signTypedData({
      domain: purchaseDomain(
        this.options.deployment.chainId,
        this.contract.address,
      ),
      types: purchaseTypes,
      primaryType: "Purchase",
      message: {
        buyer: address,
        storeId: BigInt(storeId),
        cartHash: cartHash(ids, quantities),
        maxTotal,
        nonce,
        deadline,
      },
    });
    return {
      buyer: address,
      storeId: BigInt(storeId).toString(),
      productIds: ids.map(String),
      quantities: quantities.map(String),
      maxTotal: maxTotal.toString(),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      signature,
    };
  }
  async close() {
    this.closed = true;
    await this.queue;
    this.db.close();
  }
}

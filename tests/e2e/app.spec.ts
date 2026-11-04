import { test, expect, type Page } from "@playwright/test";
import { createPublicClient, createWalletClient, http } from "viem";
import { localAccount } from "@riciclo/shared/local";
import { tokenAbi } from "@riciclo/shared/abi";
import type { Deployment } from "@riciclo/shared";
async function wallet(page: Page, index = 5) {
  await page.addInitScript(
    ({ address, rpc }) => {
      let allowed = false,
        current: string = address,
        chainId = "0x7a69";
      const listeners: Record<string, Function[]> = {};
      const emit = (event: string, value: unknown) =>
        (listeners[event] ?? []).forEach((fn) => fn(value));
      const control = {
        rejectNext: false,
        changeAccount: (address: string) => {
          current = address;
          emit("accountsChanged", [current]);
        },
        changeChain: (id: string) => {
          chainId = id;
          emit("chainChanged", id);
        },
      };
      (window as any).testWallet = control;
      (window as any).ethereum = {
        isMetaMask: true,
        on: (event: string, fn: Function) => {
          (listeners[event] ??= []).push(fn);
        },
        removeListener: (event: string, fn: Function) => {
          listeners[event] = (listeners[event] ?? []).filter(
            (item) => item !== fn,
          );
        },
        request: async ({
          method,
          params = [],
        }: {
          method: string;
          params: any[];
        }) => {
          if (method === "eth_requestAccounts") {
            allowed = true;
            return [current];
          }
          if (method === "eth_accounts") return allowed ? [current] : [];
          if (method === "eth_chainId") return chainId;
          if (method === "wallet_requestPermissions") {
            allowed = true;
            return [{ parentCapability: "eth_accounts" }];
          }
          if (method === "wallet_getPermissions")
            return allowed ? [{ parentCapability: "eth_accounts" }] : [];
          if (method === "wallet_revokePermissions") {
            allowed = false;
            return null;
          }
          if (method === "wallet_switchEthereumChain") {
            chainId = params[0].chainId;
            emit("chainChanged", chainId);
            return null;
          }
          if (method === "eth_sendTransaction" && control.rejectNext) {
            control.rejectNext = false;
            throw Object.assign(new Error("User rejected the request"), {
              code: 4001,
            });
          }
          const result = await fetch(rpc, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          }).then((r) => r.json());
          if (result.error)
            throw Object.assign(new Error(result.error.message), {
              code: result.error.code,
            });
          return result.result;
        },
      };
    },
    { address: localAccount(index).address, rpc: "http://127.0.0.1:18547" },
  );
  await page.goto("/macchinetta");
  await page.getByRole("button", { name: "Collega MetaMask" }).click();
  await expect(page.getByRole("button", { name: "Disconnetti" })).toBeVisible();
}
async function deposit(page: Page, n = 10) {
  await page.getByLabel("Bottiglie conferite").fill(String(n));
  await page.getByRole("button", { name: "Conferma conferimento" }).click();
  await expect(page.getByRole("status")).toContainText("Deposito confermato");
}
async function store(page: Page) {
  await page.getByRole("button", { name: /Usa i tuoi crediti/ }).click();
  await page.getByLabel("Negozio aderente").selectOption("4");
}
test("wallet assente: spiegazione e operazioni disabilitate", async ({
  page,
}) => {
  await page.goto("/macchinetta");
  await expect(
    page.getByText("Per continuare, installa MetaMask"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Conferma conferimento" }),
  ).toBeDisabled();
});
test("10 bottiglie, acquisto pane e tonno, saldo 5 e blocco oltre saldo", async ({
  page,
}) => {
  await wallet(page);
  await expect(page.getByTestId("balance")).toHaveText("0 RCS");
  await deposit(page);
  await expect(page.getByTestId("balance")).toHaveText("10 RCS");
  await store(page);
  await page.getByLabel("Quantità Pane").fill("1");
  await page.getByLabel("Quantità Tonno").fill("1");
  await page.getByRole("button", { name: "Richiedi preventivo" }).click();
  await expect(page.getByText("Totale confermato: 5 RCS")).toBeVisible();
  await page.getByRole("button", { name: "Conferma acquisto" }).click();
  await expect(page.getByRole("status")).toContainText("Acquisto confermato");
  await expect(page.getByTestId("balance")).toHaveText("5 RCS");
  await page.getByLabel("Quantità Tonno").fill("2");
  await expect(page.getByText("Crediti insufficienti.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Richiedi preventivo" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "test-results/supermercato-desktop.png",
    fullPage: true,
  });
});
test("rifiuto nel wallet conserva saldo; il carrello invalida il preventivo", async ({
  page,
}) => {
  await wallet(page, 6);
  await deposit(page);
  await store(page);
  await page.getByLabel("Quantità Pane").fill("1");
  await page.getByRole("button", { name: "Richiedi preventivo" }).click();
  await expect(page.getByText("Totale confermato: 2 RCS")).toBeVisible();
  await page.getByLabel("Quantità Acqua").fill("1");
  await expect(
    page.getByRole("button", { name: "Conferma acquisto" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Richiedi preventivo" }).click();
  await expect(page.getByText("Totale confermato: 3 RCS")).toBeVisible();
  await page.evaluate(() => {
    (window as any).testWallet.rejectNext = true;
  });
  await page.getByRole("button", { name: "Conferma acquisto" }).click();
  await expect(page.getByRole("status")).toContainText("Operazione rifiutata");
  await expect(page.getByTestId("balance")).toHaveText("10 RCS");
  await page.getByRole("button", { name: "Conferma acquisto" }).click();
  await expect(page.getByRole("status")).toContainText("Acquisto confermato");
  await expect(page.getByTestId("balance")).toHaveText("7 RCS");
});
test("rete errata, cambio account e layout mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await wallet(page, 7);
  await page.evaluate(() => {
    (window as any).testWallet.changeChain("0x1");
  });
  await expect(
    page.getByText("Il wallet è collegato a una rete diversa."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Conferma conferimento" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Passa alla rete della demo" })
    .click();
  await expect(
    page.getByRole("button", { name: "Conferma conferimento" }),
  ).toBeEnabled();
  await page.evaluate((address) => {
    (window as any).testWallet.changeAccount(address);
  }, localAccount(8).address);
  await expect(page.getByTestId("balance")).toHaveText("0 RCS");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/macchinetta-mobile.png",
    fullPage: true,
  });
});
test("prezzo cambiato: nessun burn e nuova conferma richiesta", async ({
  page,
  request,
}) => {
  await wallet(page, 9);
  await deposit(page);
  await store(page);
  await page.getByLabel("Quantità Pane").fill("1");
  await page.getByRole("button", { name: "Richiedi preventivo" }).click();
  await expect(page.getByText("Totale confermato: 2 RCS")).toBeVisible();
  const runtime = (await (await request.get("/api/config")).json()) as {
    deployment: Deployment;
  };
  const chain = {
    id: 31337,
    name: "Locale",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["http://127.0.0.1:18547"] } },
  };
  const admin = createWalletClient({
    account: localAccount(0),
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });
  const client = createPublicClient({
    transport: http(chain.rpcUrls.default.http[0]),
  });
  const update = async (price: bigint) => {
    const hash = await admin.writeContract({
      address: runtime.deployment.contractAddress,
      abi: tokenAbi,
      functionName: "setProduct",
      args: [2n, "Pane", price],
    });
    await client.waitForTransactionReceipt({ hash });
  };
  try {
    await update(3n);
    await page.getByRole("button", { name: "Conferma acquisto" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Il prezzo è cambiato",
    );
    await expect(page.getByTestId("balance")).toHaveText("10 RCS");
    await expect(
      page.getByRole("button", { name: "Conferma acquisto" }),
    ).toBeDisabled();
  } finally {
    await update(2n);
  }
});

test("preventivo scaduto disabilita la conferma", async ({ page }) => {
  await page.clock.install();
  await wallet(page, 10);
  await deposit(page, 1);
  await store(page);
  await page.getByLabel("Quantità Acqua").fill("1");
  await page.getByRole("button", { name: "Richiedi preventivo" }).click();
  await expect(page.getByText("Totale confermato: 1 RCS")).toBeVisible();
  await page.clock.fastForward("06:00");
  await expect(
    page.getByText("Preventivo scaduto. Richiedine uno nuovo."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Conferma acquisto" }),
  ).toBeDisabled();
});
test("ETH insufficienti: accredito possibile, acquisto disabilitato", async ({
  page,
}) => {
  const rpc = "http://127.0.0.1:18547";
  await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "hardhat_setBalance",
      params: [localAccount(11).address, "0x0"],
    }),
  });
  await wallet(page, 11);
  await deposit(page, 1);
  await store(page);
  await page.getByLabel("Quantità Acqua").fill("1");
  await page.getByRole("button", { name: "Richiedi preventivo" }).click();
  await expect(page.getByText("Totale confermato: 1 RCS")).toBeVisible();
  await expect(page.getByText("Servono ETH di test nel wallet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Conferma acquisto" }),
  ).toBeDisabled();
  await expect(page.getByTestId("balance")).toHaveText("1 RCS");
});

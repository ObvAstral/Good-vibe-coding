import { toHex } from "viem";
import { localAccount } from "@riciclo/shared/local";
const account = localAccount(5),
  key = account.getHdKey().privateKey;
if (!key) throw new Error("Chiave demo non disponibile.");
console.log(
  `Wallet pubblico Hardhat, SOLO per la rete locale 31337.\nIndirizzo: ${account.address}\nChiave privata demo: ${toHex(key)}\nNon usare questo account su reti pubbliche.`,
);

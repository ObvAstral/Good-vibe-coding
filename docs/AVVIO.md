# Guida operativa

Versione corrente del modulo operativo: protocollo `2`. Per il riepilogo delle modifiche e le responsabilità dei colleghi leggere [IMPLEMENTAZIONE.md](IMPLEMENTAZIONE.md#aggiornamento-per-i-colleghi--protocollo-2) e [CONSEGNA_AI.md](CONSEGNA_AI.md#stato-dei-lavori).

## Struttura e configurazione

`contracts/` contiene Solidity, configurazione Hardhat e test. `server/` contiene API e registri SQLite dei depositi e degli acquisti. `web/` contiene le pagine React. `shared/` contiene protocollo EIP-712, tipi e ABI generata dalla compilazione. Il deploy produce un manifest JSON con protocolVersion, ABI, chainId, contractAddress, deploymentBlock, deploymentBlockHash e nomi dimostrativi dei punti.

Node e npm di riferimento sono 22.22.2 e 10.9.7. Le versioni esatte delle dipendenze sono nel lockfile; usare `npm ci`. La prima installazione scarica anche i plugin nativi dell’SDK QVAC, ma i test operativi non caricano modelli AI. Il compilatore Solidity 0.8.28 viene scaricato al primo build; l’ABI generata non va modificata a mano.

Per avviare i componenti separatamente, dalla radice:

```sh
cp .env.example .env
npm run compile
npm run chain
```

In un altro terminale:

```sh
npm run deploy:local
npm run dev:server
```

In un terzo terminale:

```sh
npm run dev:web
```

Con questa configurazione il database è `.data/local.sqlite`. Dopo l’arresto della rete Hardhat, i suoi dati on-chain vengono persi: eseguire `npm run demo:reset` prima di un nuovo deployment. Un cambio di deployment con un database precedente viene rifiutato. Manifest e database non sono inclusi nel repository.

## Account e punti iniziali

| ID  | Punto                  | Tipo    | Circoscrizione | Account locale |
| --- | ---------------------- | ------- | -------------- | -------------- |
| 1   | Macchinetta Aurora     | MACHINE | 7              | Hardhat 1      |
| 2   | Macchinetta Santa Rita | MACHINE | 2              | Hardhat 2      |
| 3   | Market Aurora          | STORE   | 7              | Hardhat 3      |
| 4   | Market Santa Rita      | STORE   | 2              | Hardhat 4      |

L’account Hardhat 0 è amministratore; il 5 è l’acquirente usato dallo script demo e suggerito per MetaMask. Sono identità pubbliche di sviluppo. Il deploy non pre-emette crediti e non trasferisce ETH: sulla rete locale gli account Hardhat sono già finanziati. Per importare l’acquirente: `npm run wallet:local`. Può essere usato anche un qualsiasi wallet MetaMask con zero ETH: macchinetta e supermercato pagano le rispettive transazioni, il cliente firma soltanto il consenso alla spesa.

I punti sono esempi, non terminali fisici verificati. Le circoscrizioni 7 e 2 consentono di testare emissione e spesa in zone diverse. Il catalogo globale parte da acqua=1, pane=2, prosciutto=4 e tonno=3 RCS. Nessuna gestione di scorte o euro.

## API

Gli indirizzi sono stringhe Ethereum. Gli ID uint256 e gli interi on-chain nelle risposte sono stringhe decimali. Quantità in ingresso (`bottles` e `quantity`) sono numeri interi da 1 a 100. I body non accettano campi aggiuntivi. Gli errori generali hanno forma `{ "error": { "code": "...", "message": "..." } }`.

### Deposito

`POST /api/deposits`

```json
{
  "recipient": "0x0000000000000000000000000000000000000005",
  "machineId": "1",
  "bottles": 10,
  "requestId": "1a6a8241-6093-4bc2-a76a-46492de46b27"
}
```

Risposta 202 finché l’operazione è in corso; 200 se già confermata; 409 se l’UUID era associato a un payload diverso; 422 per un deposito definitivamente rifiutato. La risposta operativa contiene `requestId`, `txHash` (anche null prima della preparazione), `status` e un eventuale `error` testuale. Gli stati sono `prepared`, `pending`, `confirmed`, `failed`.

`GET /api/deposits/:requestId` recupera lo stato; restituisce 404 se assente. In caso di timeout ripetere la stessa richiesta con lo stesso UUID. Il backend registra i byte firmati prima di inviarli e conserva l’hash; i recuperi ritrasmettono la stessa transazione. Un worker riprende periodicamente le richieste incomplete. SQLite e la coda per le transazioni sono progettati per **una singola istanza backend**, che deve essere l’unica a usare le chiavi dei terminali per inviare transazioni.

Le richieste diventano confermate soltanto dopo receipt riuscita. La demo usa una receipt della rete Hardhat come conferma operativa.

### Preventivo

`POST /api/purchase-quotes`

```json
{
  "buyer": "0x0000000000000000000000000000000000000005",
  "storeId": "4",
  "cart": [
    { "productId": "2", "quantity": 1 },
    { "productId": "4", "quantity": 1 }
  ]
}
```

La risposta contiene `buyer`, `storeId`, `productIds`, `quantities`, `maxTotal`, `nonce`, `deadline` e `signature`. Gli articoli sono ordinati per ID; duplicati e carrelli con più di quattro prodotti sono rifiutati. Il totale viene letto dal contratto. La scadenza è `max(timestamp dell’ultimo blocco, ora del server) + 300 secondi`: anche dopo una pausa della rete Hardhat un nuovo preventivo rimane valido cinque minuti. I nonce sono casuali uint256, verificati contro i consumati del buyer.

Il backend firma il preventivo EIP-712 `Purchase`; il wallet dell’utente firma un messaggio distinto `PurchaseAuthorization`, con gli stessi dati del carrello, importo, negozio, nonce e scadenza. Il dominio ha versione `2`. Il supermercato invia e paga la transazione `purchase`, che brucia i crediti dal buyer autorizzante. Il cliente non invia transazioni e non deve possedere ETH. `maxTotal` deve corrispondere esattamente al costo attuale. Dopo una variazione di prezzo, rotazione dell’operatore o scadenza serve un nuovo preventivo. Il dominio vincola firma a rete e contratto. Non è richiesto `approve`.

### Acquisto pagato dal supermercato

`POST /api/purchases`

```json
{
  "quote": {
    "buyer": "0x0000000000000000000000000000000000000005",
    "storeId": "4",
    "productIds": ["2", "4"],
    "quantities": ["1", "1"],
    "maxTotal": "5",
    "nonce": "123",
    "deadline": "1794000000",
    "signature": "0x...firma del negozio..."
  },
  "buyerSignature": "0x...firma del buyer..."
}
```

Usare esattamente il preventivo restituito dalle API. Le firme sono ECDSA da 65 byte. Il consenso del buyer viene verificato prima di preparare la transazione del negozio. Il chiamante on-chain deve essere l’operatore corrente di quello store; un preventivo da solo non consente di bruciare crediti.

La risposta contiene `buyer`, `nonce`, `txHash` (anche null prima della preparazione), `status` (`prepared`, `pending`, `confirmed`, `failed`) ed eventuale `error`. Status HTTP: 202 in corso, 200 già confermato, 422 operazione rifiutata; 409 se lo stesso buyer/nonce era associato a un payload diverso. `GET /api/purchases/:buyer/:nonce` recupera lo stato, con 404 se assente. Il browser conserva il consenso fino all’esito e riprende il recupero anche dopo un ricaricamento della pagina.

Il backend conserva transazione firmata e hash prima del broadcast. Non crea una seconda transazione o un secondo burn in caso di retry o timeout. La prenotazione dei nonce delle transazioni considera depositi e acquisti insieme, anche se lo stesso operatore viene associato a entrambi i tipi di punto. Un negozio senza ETH lascia la richiesta in attesa, recuperabile dopo il finanziamento del suo account; il wallet del cliente non paga commissioni.

`GET /api/config` restituisce manifest, punti e RPC pubblico per le letture dal browser. Il valore predefinito è lo stesso RPC Hardhat del backend; `PUBLIC_RPC_URL` permette di modificarne l’indirizzo letto dal browser. `GET /api/health` verifica che il processo risponda.

Le chiavi restano nel backend: nessuna chiave amministratore o terminale deve essere inserita in una variabile `VITE_*`. L’amministrazione di punti e catalogo avviene da script/viem usando l’ABI, senza endpoint amministrativi pubblici. In seguito a rotazione, aggiornare le chiavi configurate e riavviare il backend.

## Modificare e ripetere gli esperimenti su Hardhat

Tutto il modulo operativo usa la rete Hardhat locale, chainId 31337. Deploy e backend rifiutano RPC non loopback o una chainId differente. Non servono faucet o account su reti pubbliche.

Modificare il contratto, eseguire `npm test` e `npm run build`, arrestare i servizi e ricreare la demo con `npm run demo:reset` seguito da `npm run dev`. Le modifiche Solidity richiedono un nuovo deploy; le modifiche alle pagine hanno hot reload di Vite. Per ricaricare automaticamente il backend durante lo sviluppo si può usare `npx tsx watch --env-file-if-exists=.env server/src/main.ts` con la rete già avviata.

Per sperimentare con operatori diversi da quelli del seed, impostare `LOCAL_DEMO=0` e le quattro chiavi operatore locali in `.env`, aggiornare i punti tramite l’amministratore e riavviare il backend. Il vincolo a Hardhat locale rimane attivo.

## Passaggio al contratto con gas del supermercato

Questa versione cambia la funzione `purchase` e porta il dominio EIP-712 alla versione `2`. Il contratto precedente non supporta gli acquisti inviati dal negozio: serve un nuovo deploy. Il backend rifiuta manifest e contratti precedenti per evitare acquisti incompatibili.

Per ricreare la demo locale, arrestare i servizi e usare:

```sh
npm run demo:reset
npm run dev
```

Il reset cancella lo stato precedente della demo; i crediti del vecchio contratto non vengono migrati. Il codice non esegue questa pulizia automaticamente. Dopo il nuovo avvio ricaricare il sito e conferire nuovamente le bottiglie per ottenere i crediti sul nuovo contratto.

## Consegna al planner

`fixtures/planner.synthetic.json` contiene dati esplicitamente sintetici con due giorni, un wallet ricorrente, raccolta nella circoscrizione 7 e spesa nella 2. Include totali attesi e verifica dei distinti sull’intero periodo.

Dopo la demo on-chain:

```sh
npm run fixtures
```

Il comando esporta `.data/planner-events.json`: eventi applicativi con metadati RPC, manifest, fonte, periodo e aggregati di riferimento. La fonte è marcata `hardhat_local`; il conferimento fisico resta simulato. Legge fino a `latest`: è uno strumento per produrre fixture, non l’indicizzatore con finestra di conferma e gestione reorg descritto nell’interfaccia del collega.

Non sommare gli eventi ERC20 `Transfer` ai conteggi applicativi. I wallet distinti non identificano persone e la differenza tra emissione e burn di una zona non descrive il saldo dei residenti. Il planner, i dataset e l’analisi AI rimangono indipendenti.

## Collaudo manuale MetaMask

Collegare l’account locale 5; verificare rete e saldo zero. Conferire 10 bottiglie dalla macchinetta 1 e attendere saldo 10. Passare al negozio 4, selezionare un pane e un tonno, richiedere il preventivo e firmare nel wallet il consenso alla spesa: il supermercato invia la transazione e saldo e supply saranno 5. Verificare il caso anche con un cliente con zero ETH: l’acquisto riesce, il saldo ETH del cliente resta invariato e il gas viene addebitato al negozio. Provare due tonni: l’interfaccia segnala saldo insufficiente. Rifiutare un acquisto nel wallet e verificare saldo invariato. Cambiare rete/account e verificare invalidazione del preventivo.

## Dipendenze

La dipendenza Zod 4 dell’SDK QVAC è fissata tramite override alla patch 4.6.6. `npm audit --omit=dev` non segnala vulnerabilità al momento della verifica. L’audit completo segnala ancora Zod 3 nella toolchain Hardhat: non viene sostituito forzatamente con una versione major incompatibile. Questi strumenti lavorano su configurazioni e test locali; le API operative usano gli schemi di Fastify e un limite di 16 KiB per richiesta. [Advisory Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

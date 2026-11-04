# Riciclo Solidale — specifica del modulo operativo

Stato: specifica di riferimento per il modulo operativo implementato. Per avvio, verifiche e limiti della demo leggere [AVVIO.md](AVVIO.md). Lo sviluppo e la demo usano esclusivamente Hardhat locale.

## Aggiornamento per i colleghi — protocollo 3

Stato verificato al 4 novembre 2026: contratto, backend dei terminali, pagine `/macchinetta` e `/supermercato`, deploy locale e fixture sono implementati. La demo contiene esattamente **10 bidoni e 6 supermercati fissi**, inizializzati dal costruttore. Lo sviluppo usa Hardhat locale, chainId `31337`. La configurazione RAG e il planner seguono i documenti dedicati e restano un modulo separato.

| Operazione              | Chi autorizza                              | Chi invia la transazione e paga il gas      |
| ----------------------- | ------------------------------------------ | ------------------------------------------- |
| Conferimento e mint RCS | Operatore della macchinetta                | Macchinetta, tramite backend                |
| Preventivo              | Negozio, con firma `Purchase`              | Nessuna transazione                         |
| Acquisto e burn RCS     | Cliente, con firma `PurchaseAuthorization` | Operatore del supermercato, tramite backend |

Il cliente può usare il proprio wallet con zero ETH. Il supermercato può bruciare soltanto i crediti autorizzati per quel carrello, importo, nonce e scadenza. La conferma in MetaMask è una firma; il browser non invia la transazione di acquisto.

Nel protocollo `3` i punti sono fissi e gli eventi aggiungono `neighborhoodId`; il dominio EIP-712 ha versione `3` e il manifest espone `protocolVersion: "3"`, catalogo dei quartieri e provenienza delle assegnazioni. Serve un nuovo deploy e la rigenerazione dell’ABI. Le firme degli eventi sono cambiate: per il planner il cliente è `PurchaseCompleted.buyer`, mentre `transaction.from` è l’operatore del negozio.

Il reset locale elimina lo stato della demo precedente e i crediti non vengono migrati automaticamente. La procedura è in [AVVIO.md](AVVIO.md#passaggio-al-contratto-di-protocollo-3). Il confronto con l’indicizzatore del planner e il collaudo manuale con l’estensione MetaMask restano attività di integrazione; non sono sostituiti dai test del simulatore.

## Obiettivo e confini

Realizzare un modulo indipendente dal Social Impact Planner: due pagine React collegate allo stesso wallet, una macchinetta simulata che emette crediti per le bottiglie e un supermercato che li brucia al pagamento. Nessun rimborso in euro o trasferimento al commerciante nel prototipo. Il planner usa gli eventi del contratto secondo [l'interfaccia dati](INTERFACCIA_PLANNER.md).

Scelte concordate: Solidity, pagamento con burn, spesa limitata agli esercenti affiliati, tracciamento separato del punto di emissione e del punto di acquisto. Non si attribuisce ogni token speso alla macchinetta di origine.

I dettagli seguenti sono default implementativi scelti per rendere il lavoro eseguibile; nomi e prezzi sono dimostrativi.

## Stack e organizzazione

- Frontend React, TypeScript e Vite, routing `/macchinetta` e `/supermercato`; wagmi e viem per wallet e transazioni. MetaMask come wallet di riferimento.
- Solidity con OpenZeppelin Contracts 5.x; Hardhat per compilazione, test e rete locale. Bloccare le versioni compatibili nel lockfile al setup.
- Backend Node.js e TypeScript per simulare i terminali autorizzati. Le chiavi dei terminali restano nel backend, mai in variabili VITE o nel browser.
- Directory distinte `web/`, `contracts/`, `server/` e pacchetto `shared/` per tipi, firme e ABI generata; mantenere gli attuali script QVAC e il relativo archivio. Il planner del collega rimane indipendente.
- Sviluppo e demo su rete Hardhat locale, chainId 31337, con account di sviluppo già dotati di ETH locali. Il terminale paga il gas del mint; il supermercato paga il gas dell’acquisto. Il cliente può avere zero ETH.
- `protocolVersion`, ABI, chainId, indirizzo del contratto, blocco e hash del deploy esportati in un manifest condiviso. Il deploy genera il manifest prima dell'avvio dei moduli.

## Token e contratto

Un contratto `RicicloSolidale` estende ERC20, AccessControl e EIP712. Nome `Riciclo Solidale`, simbolo `RCS`, decimals 0. Una bottiglia emette un credito. Non si promette equivalenza o convertibilità in euro.

Bloccare i trasferimenti ordinari, inclusi quelli effettuati con transferFrom: sono ammessi soltanto mint e burn nei percorsi controllati. Non esporre burn generici. L'acquisto brucia dal buyer che ha firmato l’autorizzazione, mentre il chiamante è l’operatore del supermercato. Non richiede approve.

Il costruttore inizializza 16 punti fissi: 10 MACHINE e 6 STORE. Ogni punto ha ID stabile, `zoneId` (circoscrizione 1–8), `neighborhoodId` (codice IDQUART), operatore e stato attivo. Non esiste una funzione pubblica di registrazione: nemmeno l’amministratore può aggiungere punti. ID, tipo, quartiere e circoscrizione restano immutabili. L’amministratore può disattivare punti, ruotare operatori e modificare il catalogo prodotti. Cambiare la rete dei punti richiede una modifica del codice e un nuovo deploy.

Catalogo iniziale globale: 1 acqua = 1 RCS; 2 pane = 2 RCS; 3 prosciutto = 4 RCS; 4 tonno = 3 RCS. Prezzi interi positivi nel contratto, identici per tutti i negozi. Nessuna gestione scorte nel prototipo.

### Geografia della demo

Le assegnazioni dei punti ai quartieri sono fisse e dimostrative, senza coordinate o indirizzi fisici verificati. `shared/src/geography.ts` contiene nomi dei 23 quartieri, codici IDQUART, fonte e SHA-256 del CSV di popolazione 2025. L’ID `0` di residenza virtuale è escluso. Il contratto conserva il codice del quartiere; backend e manifest ne espongono anche il nome.

Aurora ha quartiere `7` e circoscrizione `7`; Santa Rita ha quartiere `11` e circoscrizione `2`. Il quartiere identifica il luogo del conferimento o dell’acquisto, non la residenza del wallet o la provenienza di ogni singola unità RCS. L’elenco completo dei 16 punti è in [AVVIO.md](AVVIO.md#account-e-punti-iniziali).

### Mint

`deposit(machineId, recipient, bottles, depositId)` è chiamabile soltanto dall'operatore attivo della macchinetta indicata. Verifica destinatario non nullo, da 1 a 100 bottiglie e depositId bytes32 mai usato. Marca l'ID e conia bottles RCS atomicamente. ID globalmente univoco per impedire repliche, anche tra punti.

### Acquisto

`purchase(buyer, storeId, productIds, quantities, maxTotal, nonce, deadline, storeSignature, buyerSignature)` viene chiamata dall’operatore corrente del supermercato, che paga il gas. Il negozio deve essere attivo. Il backend firma un preventivo EIP-712 di tipo `Purchase`; il wallet del cliente firma separatamente il consenso di tipo `PurchaseAuthorization`. Entrambe le firme contengono buyer, storeId, hash del carrello ordinato, maxTotal, nonce e deadline. Il dominio `Riciclo Solidale`, versione `3`, è vincolato a chainId e contratto.

Il contratto verifica chiamante, entrambe le firme, scadenza e nonce inutilizzato per quel buyer. Le firme di preventivo e consenso non sono intercambiabili. Validità del preventivo: 5 minuti. Il cliente non invia transazioni e non necessita ETH. Nessun percorso consente al supermercato di bruciare crediti senza consenso del buyer.

Carrello: da 1 a 4 prodotti, ID strettamente crescenti senza duplicati, quantità da 1 a 100 per articolo. Ricalcolare il costo dai prezzi attuali del contratto; richiedere totale uguale a maxTotal, così un cambio di prezzo richiede una nuova conferma. Verificare saldo sufficiente, consumare nonce, bruciare il totale ed emettere evento, tutto atomicamente. Il negozio firmatario certifica il punto di acquisto simulato: non basta accettare uno storeId libero dal browser.

### Contratto delle firme condiviso

I due tipi EIP-712 hanno campi uguali e nomi distinti:

```text
Purchase(address buyer,uint256 storeId,bytes32 cartHash,uint256 maxTotal,uint256 nonce,uint256 deadline)
PurchaseAuthorization(address buyer,uint256 storeId,bytes32 cartHash,uint256 maxTotal,uint256 nonce,uint256 deadline)
cartHash = keccak256(abi.encode(productIds, quantities))
```

Gli array `productIds` e `quantities` sono `uint256[]`. Il dominio è `{ name: "Riciclo Solidale", version: "3", chainId, verifyingContract }`. Per evitare differenze di codifica usare `purchaseDomain`, `purchaseMessage`, `buyerAuthorization` e `purchaseArgs` esportati da `@riciclo/shared`. Il campo `signature` del preventivo è la firma del negozio; `buyerSignature` è il consenso separato del cliente. Le chiavi dei terminali restano nel backend.

Il backend calcola `deadline = max(timestamp dell’ultimo blocco, ora del server) + 300`: un nuovo preventivo non risulta già scaduto dopo una pausa della rete Hardhat. Il nonce applicativo è un uint256 casuale, consumato per buyer; è distinto dal nonce della transazione dell’operatore che paga il gas.

## Backend e frontend

- `POST /api/deposits`: recipient, machineId, bottles, requestId UUID. Il backend valida il punto e i limiti, deriva depositId da requestId, invia il mint e restituisce txHash. Associare requestId al payload e risultato in SQLite: richieste ripetute non generano ulteriori transazioni e payload diversi con lo stesso ID sono rifiutati.
- `POST /api/purchase-quotes`: buyer, storeId e carrello. Il backend legge catalogo e nonce disponibili, firma il preventivo e restituisce gli argomenti della purchase. Il wallet dell’utente firma soltanto l’autorizzazione alla spesa, senza transazione.
- `POST /api/purchases`: preventivo e firma del buyer. Il backend verifica il consenso prima di spendere gas, registra il tentativo in SQLite e invia la transazione dal conto del supermercato. Buyer/nonce identificano univocamente l’acquisto; retry e riavvii recuperano gli stessi byte firmati e lo stesso hash. `GET /api/purchases/:buyer/:nonce` recupera lo stato.
- `GET /api/config`: manifest, punti e RPC per le letture del frontend; `GET /api/deposits/:requestId`: stato del conferimento. Payload, risposte ed errori sono descritti in [AVVIO.md](AVVIO.md#api). Gli interi on-chain nelle risposte JSON sono stringhe decimali.
- Le API sono simulatori pubblici per la demo: la quantità dichiarata non prova il conferimento fisico. Validazione hardware e controllo antifrode reale sono esclusi.
- Selettore dei punti su entrambe le pagine, saldo sempre visibile, nome, quartiere e circoscrizione del punto selezionato. Al supermercato catalogo e prezzi vengono letti dal contratto.
- Gestire wallet assente/disconnesso, rete errata, saldo crediti insufficiente o ETH del supermercato insufficienti, rifiuto firma, transazione in attesa, fallita e confermata. Disabilitare invii duplicati durante una richiesta.
- Mostrare successo e aggiornare saldo soltanto dopo receipt riuscita. Preventivo scaduto o prezzo cambiato: rigenerare e chiedere nuova conferma. Non modificare il saldo solo nel frontend.

## Verifica e consegna

L’ultima verifica dell’implementazione ha superato **39 test automatici**: 11 contratto, 15 backend, 4 integrazione e 9 browser. Sono passati anche typecheck e build. La demo CLI verifica 10 bottiglie → 10 RCS → pane e tonno → burn 5, cliente con ETH invariati e gas addebitato al supermercato. Il test di integrazione verifica gli stessi passaggi con un cliente a zero ETH.

I test browser usano un provider EIP-1193 di sviluppo e vere transazioni Hardhat; la prova con l’estensione MetaMask è manuale. Le esportazioni aggiungono `byDayNeighborhood` e `byNeighborhood`, conservando i totali per circoscrizione, punto e periodo. I distinti vengono ricalcolati nel periodo e i quartieri senza osservazioni non vengono inventati come righe a utilizzo zero. Le fixture forniscono eventi e aggregati attesi, ma l’indicizzatore persistente con gestione reorg e l’analisi territoriale appartengono al planner.

Test del contratto: mint autorizzato e non autorizzato; punti inattivi; quantità e carrelli invalidi; depositId duplicato; trasferimenti vietati; firma acquisto errata o riferita ad altro buyer/rete/contratto; nonce riutilizzato; scadenza; prezzo cambiato; saldo insufficiente; burn corretto ed eventi coerenti; cliente con zero ETH e addebito del gas al supermercato; consenso buyer mancante o falsificato; chiamante non autorizzato. In caso di revert saldo, supply e nonce restano invariati.

Test del backend: idempotenza di depositi e acquisti, verifica delle due firme e gestione degli errori RPC prima e dopo il broadcast. Test di integrazione: 10 bottiglie → 10 RCS; acquisto pane e tonno → burn 5, saldo 5; secondo acquisto oltre saldo fallisce. Confrontare eventi e aggregati del planner.

Consegnare deploy riproducibile con punti/catalogo iniziali, manifest, `.env.example` senza segreti e istruzioni di avvio locale. Nessuna pubblicazione o deploy mainnet previsto.

## Storico per le analisi AI — 4 novembre 2026

Disponibili il generatore `npm run simulate:history` e l’export `data/simulated/history-v1`: 180 giorni, 5.000 operazioni, 120 wallet fittizi senza ETH. Le operazioni sono eseguite su un contratto di protocollo `3` in Hardhat isolato, con gas dei terminali; manifest e database della demo restano separati. Sono esportati log e ricevute, aggregati per quartiere/punto/giorno/mese, esposizione durante un fermo, confronti tra periodi, schede RAG senza wallet e 20 domande attese. Dettagli e limiti: [TRANSAZIONI_SIMULATE.md](TRANSAZIONI_SIMULATE.md). L’indicizzatore persistente, il ranking, gli embedding QVAC e la chat DeepSeek restano da implementare.

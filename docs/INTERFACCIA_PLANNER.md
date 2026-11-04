# Interfaccia blockchain → Social Impact Planner

> Aggiornamento: per il planner e la chat prevalgono [AI_E_DATI.md](AI_E_DATI.md) e [DATA_PIPELINE.md](DATA_PIPELINE.md). Restano validi gli eventi e le regole di indicizzazione qui descritti; gli eventi del protocollo `3` riportano direttamente il quartiere dei punti fissi della demo. Generazione via DeepSeek API; embedding e ricerca locale con QVAC secondo RAG_QVAC_DEEPSEEK.md.

Specifiche per il collega che sviluppa analisi, AI e dataset. Leggere insieme a [IMPLEMENTAZIONE.md](IMPLEMENTAZIONE.md).

## Responsabilità e dati

Il modulo operativo produce eventi; il planner li legge via RPC senza chiavi private e costruisce aggregati. QVAC e i dataset pubblici rimangono fuori dal contratto. Non serve attendere il frontend per iniziare: è possibile preparare fixture conformi agli eventi descritti qui, marcate come simulate.

Il manifest condiviso contiene `protocolVersion: "3"`, `chainId`, `contractAddress`, `deploymentBlock`, `deploymentBlockHash`, `abi`, nomi dei punti fissi, catalogo `neighborhoods` e metadati `geographySource`. Il deploy lo scrive in `deployments/local.json`; `GET /api/config` lo espone nel campo `deployment`. Dopo una modifica del contratto rigenerarlo dal deploy senza copiare a mano un vecchio indirizzo o una vecchia ABI. La chiave di un deployment è la coppia chainId/contractAddress. Il reset della rete locale richiede un nuovo indice, anche se chainId e indirizzo tornano uguali: verificare anche l’hash del blocco di deploy. Il backend controlla manifest e dominio EIP-712 e rifiuta il protocollo precedente.

## Eventi applicativi

Firme Solidity implementate nel protocollo `3` (nuova ABI necessaria rispetto alle versioni precedenti):

```solidity
event PointRegistered(uint256 indexed pointId, uint8 kind, uint8 zoneId, address operator, uint8 neighborhoodId);
event PointStatusChanged(uint256 indexed pointId, bool active);
event PointOperatorChanged(uint256 indexed pointId, address operator);
event BottlesDeposited(uint256 indexed machineId, uint8 indexed zoneId, address indexed recipient, bytes32 depositId, uint256 bottles, uint256 minted, uint8 neighborhoodId);
event PurchaseCompleted(uint256 indexed storeId, uint8 indexed zoneId, address indexed buyer, uint256 nonce, uint256[] productIds, uint256[] quantities, uint256 burned, uint8 neighborhoodId);
```

Il cliente firma solo il consenso alla spesa e può avere zero ETH. Gli acquisti sono inviati e pagati dall’operatore del supermercato: `transaction.from` è il negozio. Il wallet del fruitore rimane `PurchaseCompleted.buyer`, che va usato per `distinctPurchaseWallets`. I tre eventi territoriali aggiungono `neighborhoodId` come ultimo parametro non indicizzato; i campi indicizzati preesistenti sono conservati. Gli eventi `PointRegistered` vengono emessi nel costruttore, non da una funzione pubblica di aggiunta punti.

kind: 0 MACHINE, 1 STORE. `zoneId` è la circoscrizione di Torino (1–8); `neighborhoodId` è il quartiere storico del catalogo IDQUART (1–23). I 10 bidoni e 6 negozi hanno assegnazioni fisse, dimostrative e prive di coordinate. Non dedurre la residenza dei wallet. Zona e punto sono validati dal contratto, non dichiarazioni arbitrarie dell'acquirente. Gli eventi applicativi si emettono solo per operazioni riuscite e includono la zona storica del punto. Non sommare di nuovo i Transfer ERC20 agli eventi applicativi.

L'indicizzatore aggiunge chainId, contractAddress, blockNumber, blockHash, transactionHash, logIndex e timestamp UTC del blocco. Deduplicazione tramite chainId/contractAddress/transactionHash/logIndex. Quantità e ID uint256 on-chain sono letti come bigint ed esportati come stringhe decimali. `zoneId` e `neighborhoodId` sono uint8 e restano numeri interi nel JSON.

## Fixture e confini della consegna

- `fixtures/planner.synthetic.json`: eventi sintetici e aggregati attesi, con lo stesso wallet in più giorni e raccolta/spesa in circoscrizioni diverse.
- `npm run fixtures`: esporta `.data/planner-events.json` dalla rete Hardhat attiva, con `source: "hardhat_local"`, `physicalDepositsSimulated: true`, manifest, metadati degli eventi, periodo e aggregati di riferimento.
- L’esportazione legge fino a `latest` e non gestisce un cursore persistente o la finestra di conferma/reorg. Queste funzionalità sono ancora da implementare nell’indicizzatore del planner.
- Il quartiere proviene dall’evento e non va dedotto dalla circoscrizione. L’esportazione aggiunge il nome del quartiere e gruppi `byDayNeighborhood` e `byNeighborhood`; gli ID si collegano direttamente al catalogo e alla popolazione per quartiere. Le analisi per zona statistica richiedono un raccordo più preciso, ancora da realizzare.

## Indicizzazione e output

Usare viem per leggere log a blocchi dal deploymentBlock; recuperare timestamp dei blocchi con cache. Per la demo indicizzare fino a latest meno 2 blocchi: soglia operativa, non garanzia di finalità. Salvare cursore e hash; a ogni sincronizzazione rileggere almeno 12 blocchi precedenti, rimuovendo e ricostruendo i dati da quel punto. Se il precedente hash del cursore non corrisponde oltre tale finestra, ricostruire dal deploymentBlock. Upsert dei log evita duplicati.

Il JSON operativo già prodotto contiene gruppi per giorno/quartiere, quartiere, giorno/circoscrizione e punto. L’indicizzatore del planner dovrà produrre CSV/JSON persistenti con: depositCount, bottlesCollected, tokensMinted, purchaseCount, tokensBurned, distinctDepositWallets e distinctPurchaseWallets. Calcolare anche totali per punto. I distinti vanno ricalcolati per la finestra richiesta: non sommare i distinti giornalieri. Esporre blocco indicizzato, ultimo aggiornamento e periodo coperto. Assenza di dati non equivale a zero utilizzo osservato se l'indicizzazione è incompleta.

Le quantità sono crediti RCS interi, non euro. I token possono essere emessi in una circoscrizione e spesi in un'altra: non interpretare minted meno burned per zona come saldo dei residenti, né burned/minted locale come tasso di conversione della stessa popolazione. Non ricostruiamo la macchinetta di origine di ogni credito bruciato.

## Dataset e AI

La traccia WELFARE richiede un Social Impact Planner. Fonti previste: AperTO Torino per popolazione per età/circoscrizione e servizi sociali; Open Data Piemonte per strutture sociosanitarie. Gli originali scaricati e i controlli sui file sono descritti in [DATA_PIPELINE.md](DATA_PIPELINE.md#stato-verificato). Le importazioni normalizzate devono ancora documentare schema, licenza, anno, copertura e raccordi geografici; disponibilità degli originali e pipeline applicativa completata sono stati distinti.

Aggregare i servizi geolocalizzati secondo i raccordi verificati di DATA_PIPELINE.md, distinguendo quartiere, zona statistica e circoscrizione; conservare gli elementi non assegnabili come mancanti. Usare una tabella di corrispondenza esplicita per codici territoriali differenti. Documentare fonte, data e trasformazioni. Demografia e servizi non stimano direttamente il numero di persone senza dimora.

Il collega calcola indicatori riproducibili e prepara schede territoriali con numeri, fonti, periodo e dati mancanti. QVAC gestisce embedding e recupero locale; il backend passa aggregati ed evidenze a DeepSeek per spiegare confronti e proposte. L’operatore decide, secondo AI_E_DATI.md e RAG_QVAC_DEEPSEEK.md. Il modello non inventa valori mancanti e non autorizza mint, burn o assegnazioni di fondi.

Poco utilizzo può dipendere da assenza di negozi, accessibilità, guasti o scarsa conoscenza del servizio. Molto utilizzo misura adozione, non prova da solo impatto sociale o bisogno. Wallet distinti non sono persone distinte e la zona di spesa non è residenza. L'AI riceve aggregati, senza indirizzi wallet o profili individuali.

## Accettazione

Con fixture note, verificare totali per giorno, punto e circoscrizione; nessun doppio conteggio dopo due sincronizzazioni; nessun evento da transazioni fallite; ricostruzione dopo rollback; gestione di wallet presenti in più giorni e di raccolta/spesa in zone diverse. La demo deve distinguere dati sintetici e transazioni eseguite sulla rete Hardhat locale, mostrando periodo e fonti.

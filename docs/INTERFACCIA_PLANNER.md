# Interfaccia blockchain → Social Impact Planner

Specifiche per il collega che sviluppa analisi, AI e dataset. Leggere insieme a [IMPLEMENTAZIONE.md](IMPLEMENTAZIONE.md).

## Responsabilità e dati

Il modulo operativo produce eventi; il planner li legge via RPC senza chiavi private e costruisce aggregati. QVAC e i dataset pubblici rimangono fuori dal contratto. Non serve attendere il frontend per iniziare: è possibile preparare fixture conformi agli eventi descritti qui, marcate come simulate.

Il manifest condiviso contiene chainId, contractAddress, deploymentBlock e ABI. La chiave di un deployment è la coppia chainId/contractAddress. Il reset della rete locale richiede un nuovo indice.

## Eventi applicativi

Firme Solidity previste:

```solidity
event PointRegistered(uint256 indexed pointId, uint8 kind, uint8 zoneId, address operator);
event PointStatusChanged(uint256 indexed pointId, bool active);
event PointOperatorChanged(uint256 indexed pointId, address operator);
event BottlesDeposited(uint256 indexed machineId, uint8 indexed zoneId, address indexed recipient, bytes32 depositId, uint256 bottles, uint256 minted);
event PurchaseCompleted(uint256 indexed storeId, uint8 indexed zoneId, address indexed buyer, uint256 nonce, uint256[] productIds, uint256[] quantities, uint256 burned);
```

kind: 0 MACHINE, 1 STORE. zoneId: circoscrizione di Torino, intero 1–8; non è un quartiere. Zona e punto sono validati dal contratto, non dichiarazioni arbitrarie dell'acquirente. Gli eventi applicativi si emettono solo per operazioni riuscite e includono la zona storica del punto. Non sommare di nuovo i Transfer ERC20 agli eventi applicativi.

L'indicizzatore aggiunge chainId, contractAddress, blockNumber, blockHash, transactionHash, logIndex e timestamp UTC del blocco. Deduplicazione tramite chainId/contractAddress/transactionHash/logIndex. Quantità on-chain lette come bigint; esportazione JSON degli interi come stringhe decimali.

## Indicizzazione e output

Usare viem per leggere log a blocchi dal deploymentBlock; recuperare timestamp dei blocchi con cache. Per la demo indicizzare fino a latest meno 2 blocchi: soglia operativa, non garanzia di finalità. Salvare cursore e hash; a ogni sincronizzazione rileggere almeno 12 blocchi precedenti, rimuovendo e ricostruendo i dati da quel punto. Se il precedente hash del cursore non corrisponde oltre tale finestra, ricostruire dal deploymentBlock. Upsert dei log evita duplicati.

Produrre CSV/JSON per giorno UTC e zoneId con: depositCount, bottlesCollected, tokensMinted, purchaseCount, tokensBurned, distinctDepositWallets e distinctPurchaseWallets. Calcolare anche totali per punto. I distinti vanno ricalcolati per la finestra richiesta: non sommare i distinti giornalieri. Esporre blocco indicizzato, ultimo aggiornamento e periodo coperto. Assenza di dati non equivale a zero utilizzo osservato se l'indicizzazione è incompleta.

Le quantità sono crediti RCS interi, non euro. I token possono essere emessi in una circoscrizione e spesi in un'altra: non interpretare minted meno burned per zona come saldo dei residenti, né burned/minted locale come tasso di conversione della stessa popolazione. Non ricostruiamo la macchinetta di origine di ogni credito bruciato.

## Dataset e AI

La traccia WELFARE richiede un Social Impact Planner. Fonti previste: AperTO Torino per popolazione per età/circoscrizione e servizi sociali; Open Data Piemonte per strutture sociosanitarie. I singoli dataset vanno selezionati verificando schema, licenza, anno e copertura: non sono ancora acquisiti o validati.

Aggregare i servizi geolocalizzati per circoscrizione usando confini ufficiali compatibili; conservare gli elementi non assegnabili come mancanti. Usare una tabella di corrispondenza esplicita per codici territoriali differenti. Documentare fonte, data e trasformazioni. Demografia e servizi non stimano direttamente il numero di persone senza dimora.

Il collega calcola indicatori riproducibili e passa a QVAC una tabella territoriale con numeri, fonti, periodo e dati mancanti. Il modello spiega i confronti e propone dove intervenire o quali verifiche fare; l'operatore decide. Il modello non inventa valori mancanti e non autorizza mint, burn o assegnazioni di fondi.

Poco utilizzo può dipendere da assenza di negozi, accessibilità, guasti o scarsa conoscenza del servizio. Molto utilizzo misura adozione, non prova da solo impatto sociale o bisogno. Wallet distinti non sono persone distinte e la zona di spesa non è residenza. L'AI riceve aggregati, senza indirizzi wallet o profili individuali.

## Accettazione

Con fixture note, verificare totali per giorno, punto e circoscrizione; nessun doppio conteggio dopo due sincronizzazioni; nessun evento da transazioni fallite; ricostruzione dopo rollback; gestione di wallet presenti in più giorni e di raccolta/spesa in zone diverse. La demo deve distinguere dati sintetici e transazioni reali di testnet, mostrando periodo e fonti.

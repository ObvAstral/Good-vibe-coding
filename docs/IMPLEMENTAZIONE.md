# Riciclo Solidale — specifica del modulo operativo

Stato: specifica per lo sviluppo, non funzionalità già implementate.

## Obiettivo e confini

Realizzare un modulo indipendente dal Social Impact Planner: due pagine React collegate allo stesso wallet, una macchinetta simulata che emette crediti per le bottiglie e un supermercato che li brucia al pagamento. Nessun rimborso in euro o trasferimento al commerciante nel prototipo. Il planner usa gli eventi del contratto secondo [l'interfaccia dati](INTERFACCIA_PLANNER.md).

Scelte concordate: Solidity, pagamento con burn, spesa limitata agli esercenti affiliati, tracciamento separato del punto di emissione e del punto di acquisto. Non si attribuisce ogni token speso alla macchinetta di origine.

I dettagli seguenti sono default implementativi scelti per rendere il lavoro eseguibile; nomi e prezzi sono dimostrativi.

## Stack e organizzazione

- Frontend React, TypeScript e Vite, routing `/macchinetta` e `/supermercato`; wagmi e viem per wallet e transazioni. MetaMask come wallet di riferimento.
- Solidity con OpenZeppelin Contracts 5.x; Hardhat per compilazione, test e rete locale. Bloccare le versioni compatibili nel lockfile al setup.
- Backend Node.js e TypeScript per simulare i terminali autorizzati. Le chiavi dei terminali restano nel backend, mai in variabili VITE o nel browser.
- Directory distinte `web/`, `contracts/`, `server/`; mantenere gli attuali script QVAC e il relativo archivio. Il planner del collega rimane indipendente.
- Sviluppo su rete locale, demo condivisa su Sepolia. Usare solo fondi di test. L'utente necessita ETH di test per gli acquisti; il terminale paga il gas del mint.
- ABI, chainId, indirizzo del contratto e blocco di deploy esportati in un manifest condiviso. Il deploy genera il manifest prima dell'avvio dei moduli.

## Token e contratto

Un contratto `RicicloSolidale` estende ERC20, AccessControl e EIP712. Nome `Riciclo Solidale`, simbolo `RCS`, decimals 0. Una bottiglia emette un credito. Non si promette equivalenza o convertibilità in euro.

Bloccare i trasferimenti ordinari, inclusi quelli effettuati con transferFrom: sono ammessi soltanto mint e burn nei percorsi controllati. Non esporre burn generici. L'acquisto brucia direttamente dal chiamante e non richiede approve.

Il deployer amministratore registra punti, associazioni territoriali e prodotti. Ogni punto ha ID stabile numerico, zoneId, tipo MACHINE o STORE, indirizzo operatore e stato attivo. zoneId è una circoscrizione torinese da 1 a 8. Tipo e zona non cambiano dopo la creazione: per spostare un punto crearne uno nuovo. Sono possibili disattivazione e rotazione dell'operatore. Solo l'amministratore modifica catalogo e punti.

Catalogo iniziale globale: 1 acqua = 1 RCS; 2 pane = 2 RCS; 3 prosciutto = 4 RCS; 4 tonno = 3 RCS. Prezzi interi positivi nel contratto, identici per tutti i negozi. Nessuna gestione scorte nel prototipo.

### Mint

`deposit(machineId, recipient, bottles, depositId)` è chiamabile soltanto dall'operatore attivo della macchinetta indicata. Verifica destinatario non nullo, da 1 a 100 bottiglie e depositId bytes32 mai usato. Marca l'ID e conia bottles RCS atomicamente. ID globalmente univoco per impedire repliche, anche tra punti.

### Acquisto

`purchase(storeId, productIds, quantities, maxTotal, nonce, deadline, signature)` viene chiamata dal wallet acquirente. Il negozio deve essere attivo. Il backend del negozio firma un'autorizzazione EIP-712 contenente buyer, storeId, hash del carrello ordinato, maxTotal, nonce e deadline. Dominio vincolato a chainId e contratto. Il contratto verifica firma dell'operatore corrente, scadenza e nonce inutilizzato per quel buyer. Impostare validità a 5 minuti.

Carrello: da 1 a 4 prodotti, ID strettamente crescenti senza duplicati, quantità da 1 a 100 per articolo. Ricalcolare il costo dai prezzi attuali del contratto; richiedere totale uguale a maxTotal, così un cambio di prezzo richiede una nuova conferma. Verificare saldo sufficiente, consumare nonce, bruciare il totale ed emettere evento, tutto atomicamente. Il negozio firmatario certifica il punto di acquisto simulato: non basta accettare uno storeId libero dal browser.

## Backend e frontend

- `POST /api/deposits`: recipient, machineId, bottles, requestId UUID. Il backend valida il punto e i limiti, deriva depositId da requestId, invia il mint e restituisce txHash. Associare requestId al payload e risultato in SQLite: richieste ripetute non generano ulteriori transazioni e payload diversi con lo stesso ID sono rifiutati.
- `POST /api/purchase-quotes`: buyer, storeId e carrello. Il backend legge catalogo e nonce disponibili, firma il preventivo e restituisce gli argomenti della purchase. È il wallet dell'utente a inviare e firmare la transazione finale.
- Le API sono simulatori pubblici per la demo: la quantità dichiarata non prova il conferimento fisico. Validazione hardware e controllo antifrode reale sono esclusi.
- Selettore dei punti su entrambe le pagine, saldo sempre visibile, nome e zona del punto selezionato. Al supermercato catalogo e prezzi vengono letti dal contratto.
- Gestire wallet assente/disconnesso, rete errata, saldo crediti o ETH insufficiente, rifiuto firma, transazione in attesa, fallita e confermata. Disabilitare invii duplicati durante una richiesta.
- Mostrare successo e aggiornare saldo soltanto dopo receipt riuscita. Preventivo scaduto o prezzo cambiato: rigenerare e chiedere nuova conferma. Non modificare il saldo solo nel frontend.

## Verifica e consegna

Test del contratto: mint autorizzato e non autorizzato; punti inattivi; quantità e carrelli invalidi; depositId duplicato; trasferimenti vietati; firma acquisto errata o riferita ad altro buyer/rete/contratto; nonce riutilizzato; scadenza; prezzo cambiato; saldo insufficiente; burn corretto ed eventi coerenti. In caso di revert saldo, supply e nonce restano invariati.

Test del backend: idempotenza dei depositi, firma del carrello e gestione degli errori RPC. Test di integrazione: 10 bottiglie → 10 RCS; acquisto pane e tonno → burn 5, saldo 5; secondo acquisto oltre saldo fallisce. Confrontare eventi e aggregati del planner.

Consegnare deploy riproducibile con punti/catalogo iniziali, manifest, `.env.example` senza segreti e istruzioni di avvio locale. Nessuna pubblicazione o deploy mainnet previsto.

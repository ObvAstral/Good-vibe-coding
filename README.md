# Riciclo Solidale

Modulo operativo per simulare il riciclo delle bottiglie e la spesa di crediti RCS nei negozi aderenti. Contratto Solidity, backend TypeScript con SQLite e due pagine React collegate allo stesso wallet. Macchinetta e supermercato pagano il gas delle operazioni: il cliente può usare un wallet senza ETH e autorizza gli acquisti con una firma. L’integrazione QVAC esistente rimane disponibile.

## Partire dal token

Con Node.js 22.22.2 e npm 10.9.7:

```sh
npm ci
npm run test:contracts
npm run chain
```

In un secondo terminale, dalla radice:

```sh
npm run deploy:local
npm run demo:token
```

La demo emette 10 RCS, acquista pane e tonno bruciando 5 RCS e, su un deployment nuovo, respinge un acquisto da 6 RCS. Verifica che il negozio paghi il gas e che gli ETH del cliente restino invariati. Non richiede browser, MetaMask o modelli AI. Il deploy genera `deployments/local.json`; `npm run compile` rigenera l’ABI condivisa.

## Avviare anche macchinetta e supermercato

Arrestare la rete del passaggio precedente, quindi:

```sh
npm run dev
```

Il comando compila, avvia una rete locale nuova, distribuisce e inizializza il contratto, avvia il backend e apre i servizi su:

- Macchinetta: http://127.0.0.1:5173/macchinetta
- Supermercato: http://127.0.0.1:5173/supermercato
- API: http://127.0.0.1:3001/api/config
- RPC: http://127.0.0.1:8545, chainId **31337**, valuta **ETH**.

Aggiungere questa rete a MetaMask. `npm run wallet:local` mostra l’account pubblico di sviluppo da importare, già dotato di ETH locali. Le sue chiavi sono pubbliche: usarlo esclusivamente sulla rete locale. Puoi usare anche il tuo wallet senza ETH locali: le commissioni sono pagate dalla macchinetta e dal supermercato. Il saldo RCS parte da zero; conferire 10 bottiglie e acquistare un pane e un tonno per arrivare a 5 RCS. All’acquisto MetaMask chiede una firma di autorizzazione alla spesa dei crediti, senza transazione del cliente.

`Ctrl+C` arresta i servizi. Per creare un nuovo deployment dopo un precedente avvio completo:

```sh
npm run demo:reset
npm run dev
```

Il nuovo flusso richiede il contratto e il manifest di protocollo `2`; se stai usando la prima versione, ricrea la demo con i comandi sopra. I crediti del vecchio contratto non vengono migrati.

Il reset rimuove soltanto manifest e database della demo locale e richiede che la rete sia arrestata. Anche il planner dovrà ricostruire il proprio indice dopo un reset.

## Stato e consegna ai colleghi

Il modulo operativo è implementato nel protocollo `2`; l’ultima verifica ha superato 34 test automatici, typecheck e build. Il planner e la chat RAG sono il lavoro successivo, descritto nei documenti dedicati. Riepilogo delle modifiche, interfacce e responsabilità: [implementazione](docs/IMPLEMENTAZIONE.md#aggiornamento-per-i-colleghi--protocollo-2) e [consegna AI](docs/CONSEGNA_AI.md#stato-dei-lavori). Il collaudo con l’estensione MetaMask e il confronto con l’indicizzatore del planner restano verifiche manuali/di integrazione.

## Verifiche

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run doctor
```

I test automatici usano reti e database isolati; i test browser usano un provider EIP-1193 di sviluppo, con transazioni reali sulla rete Hardhat. Il collegamento con l’estensione MetaMask richiede anche una verifica manuale. `doctor` verifica QVAC senza scaricare modelli.

[Guida operativa e API su Hardhat](docs/AVVIO.md) · [Specifica](docs/IMPLEMENTAZIONE.md) · [Interfaccia planner](docs/INTERFACCIA_PLANNER.md)

## Integrazione QVAC esistente

Progetto per ai2b con QVAC SDK 0.23.0, incluso come archivio locale in `vendor/`.

### Avvio QVAC

Servono Node.js >=22.17 e npm >=10.9. Dalla cartella del progetto:

```sh
npm install
npm run doctor
npm start
```

`doctor` verifica l'import dell'SDK e una risposta reale del worker Bare, senza scaricare modelli. `npm start` avvia una chat locale con Llama 3.2 1B Q4; `/exit` chiude la chat. Il primo avvio richiede Internet per scaricare il modello (circa 0,8 GB), poi il modello rimane nella cache dell'SDK. L'installazione richiede Internet anche se l'archivio dell'SDK è già incluso, perché le sue dipendenze sono distribuite separatamente. Non serve una API key.

Per una singola richiesta o una verifica completa di download, caricamento e inferenza:

```sh
npm start -- 'Spiega in italiano cosa è un SDK'
npm run smoke
```

### Uso dell’SDK

```js
import { sdk } from "./src/sdk.js";
```

Il modulo carica la configurazione di questo progetto; `QVAC_CONFIG_PATH`, se impostata, permette di usarne un'altra. `qvac.config.json` abilita il plugin di generazione testo e concede al worker fino a 120 secondi per avviarsi. Gli esempi liberano il modello e chiudono il worker alla fine.

Se npm segnala `ENOTFOUND`, verifica rete e DNS verso `registry.npmjs.org`, quindi ripeti `npm install`. Se `doctor` riesce ma il download del modello fallisce, verifica la connessione e riprova `npm run smoke`.

Documentazione ufficiale: https://docs.qvac.tether.io/sdk/js-ts-sdk/

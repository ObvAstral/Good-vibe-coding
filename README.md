# Good-vibe-coding

Progetto per ai2b con QVAC SDK 0.23.0, incluso come archivio locale in `vendor/`.

## Avvio

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

## Integrazione

```js
import { sdk } from './src/sdk.js';
```

Il modulo carica la configurazione di questo progetto; `QVAC_CONFIG_PATH`, se impostata, permette di usarne un'altra. `qvac.config.json` abilita il plugin di generazione testo e concede al worker fino a 120 secondi per avviarsi. Gli esempi liberano il modello e chiudono il worker alla fine.

Se npm segnala `ENOTFOUND`, verifica rete e DNS verso `registry.npmjs.org`, quindi ripeti `npm install`. Se `doctor` riesce ma il download del modello fallisce, verifica la connessione e riprova `npm run smoke`.

Documentazione ufficiale: https://docs.qvac.tether.io/sdk/js-ts-sdk/

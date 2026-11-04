# Verifica embedding del planner

Per il servizio completo, il collegamento agli eventi del collega, l'indice reale,
gli utenti e la chat vedere [GUIDA.md](GUIDA.md). La prova seguente resta un controllo
isolato di compatibilità e non richiede DeepSeek.

La configurazione `qvac.config.js` del planner è separata dalla chat CLI nella
radice. Il candidato embedding è Qwen3 Embedding 0.6B Q8_0, con revisione,
licenza, URL e checksum fissati in `embedding-model.json`. La sua compatibilità
locale è attestata soltanto da una probe completata con successo.

Dalla radice, dopo `npm ci`:

```sh
mkdir -p .qvac/models
curl -fL -C - -o .qvac/models/Qwen3-Embedding-0.6B-Q8_0.gguf.part \
  https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/370f27d7550e0def9b39c1f16d3fbaa13aa67728/Qwen3-Embedding-0.6B-Q8_0.gguf
```

Verificare SHA-256 prima di rinominare il file:

```sh
echo '06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439  .qvac/models/Qwen3-Embedding-0.6B-Q8_0.gguf.part' | sha256sum --check
mv .qvac/models/Qwen3-Embedding-0.6B-Q8_0.gguf.part .qvac/models/Qwen3-Embedding-0.6B-Q8_0.gguf
QVAC_EMBEDDING_MODEL_PATH=.qvac/models/Qwen3-Embedding-0.6B-Q8_0.gguf npm run planner:probe
```

In alternativa configurare `.env` seguendo `.env.example`. Non serve una chiave
DeepSeek. La probe controlla checksum, loadModel, vettori di 1024 dimensioni,
ingest completo, chiusura/riapertura del workspace e 15 ricerche italiane su
evidenze sintetiche. Non esegue reindex su questo piccolo corpus. Salva il
rapporto in `.data/planner/embedding-probe.json` e rimuove il workspace di prova.
La prova di riapertura non equivale ancora a un test di riavvio dell'intero
servizio. Le fixture sono uno smoke test di compatibilità, non una valutazione
della qualità sul corpus completo del progetto.

I percorsi del modello e della configurazione relativi sono risolti dalla radice
del repository; cache e workspace restano nella directory ignorata `.qvac/`.
Il modello viene caricato su CPU per questa verifica ripetibile. L'esempio CLI
esistente mantiene il proprio modello di completion e la propria configurazione.

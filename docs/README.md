# Documentazione tecnica — Riciclo Solidale

- [Avvio e guida operativa](AVVIO.md): token locale, API, wallet, reset e test su Hardhat.

- [Implementazione del modulo operativo](IMPLEMENTAZIONE.md): stack, contratto, wallet, macchinetta, supermercato, API e test.
- [Guida RAG QVAC + DeepSeek](RAG_QVAC_DEEPSEEK.md): punto di ingresso, architettura concordata e integrazione.
- [Chat interna e AI](AI_E_DATI.md): architettura, strumenti, API, accessi e budget DeepSeek.
- [Pipeline e ranking](DATA_PIPELINE.md): dataset, raccordi geografici e top 3.
- [Consegna e verifiche](CONSEGNA_AI.md): ordine di lavoro e accettazione.
- [Interfaccia per il collega: planner e AI](INTERFACCIA_PLANNER.md): eventi, indicizzazione, aggregati e collegamento ai dataset WELFARE.

Le specifiche definiscono i contratti di comportamento; il modulo operativo è implementato e dispone di test automatici. Il lavoro usa esclusivamente Hardhat locale, con reset e test ripetibili. Mantengono separate la simulazione operativa e l'analisi territoriale.

Riferimenti: [OpenZeppelin ERC20](https://docs.openzeppelin.com/contracts/5.x/erc20), [eventi Solidity](https://docs.soliditylang.org/en/latest/contracts.html#events), [reti Ethereum](https://ethereum.org/developers/docs/networks/), [QVAC](https://docs.qvac.tether.io/sdk/js-ts-sdk/). Traccia locale: `Traccia 3_ WELFARE.pdf` nella radice del repository.

Per il planner seguire le nuove specifiche AI_E_DATI.md e DATA_PIPELINE.md: aggiornano la precedente ipotesi di sola generazione QVAC e analisi per circoscrizione. La demo concordata usa Hardhat locale; Sepolia resta un eventuale sviluppo successivo.

Scelta aggiornata: QVAC per embedding e ricerca locale, DeepSeek API per generazione. La ricerca solo testuale e QVAC opzionale sono ipotesi superate. Il modello embedding effettivo richiede ancora verifica di compatibilità.

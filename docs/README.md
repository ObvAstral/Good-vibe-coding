# Documentazione tecnica — Riciclo Solidale

## Modulo operativo disponibile — protocollo 2

Aggiornamento del 4 novembre 2026: contratto RCS, backend, pagine del simulatore, deploy Hardhat e fixture sono implementati. Il cliente firma gratuitamente la spesa; il supermercato invia l’acquisto e paga il gas. Il cambio di contratto richiede un nuovo deploy; i crediti della versione precedente non sono migrati automaticamente.

Per i colleghi, partire dal [riepilogo di implementazione](IMPLEMENTAZIONE.md#aggiornamento-per-i-colleghi--protocollo-2) e dallo [stato dei lavori](CONSEGNA_AI.md#stato-dei-lavori). Le verifiche automatiche del modulo operativo sono 34; collaudo MetaMask reale e confronto con il planner restano attività di integrazione.

- [Avvio e guida operativa](AVVIO.md): token locale, API, wallet, reset e test su Hardhat.

- [Implementazione del modulo operativo](IMPLEMENTAZIONE.md): stack, contratto, wallet, macchinetta, supermercato, API e test.

## Planner, dati e AI — specifiche da implementare

- [Guida RAG QVAC + DeepSeek](RAG_QVAC_DEEPSEEK.md): punto di ingresso, architettura concordata e integrazione.
- [Chat interna e AI](AI_E_DATI.md): architettura, strumenti, API, accessi e budget DeepSeek.
- [Pipeline e ranking](DATA_PIPELINE.md): dataset, raccordi geografici e top 3.
- [Consegna e verifiche](CONSEGNA_AI.md): ordine di lavoro e accettazione.
- [Interfaccia per il collega: planner e AI](INTERFACCIA_PLANNER.md): eventi, indicizzazione, aggregati e collegamento ai dataset WELFARE.

Le specifiche definiscono i contratti di comportamento; il modulo operativo è implementato e dispone di test automatici. La blockchain del progetto usa esclusivamente Hardhat locale, con reset e test ripetibili. La simulazione operativa e l’analisi territoriale rimangono moduli distinti.

Riferimenti: [OpenZeppelin ERC20](https://docs.openzeppelin.com/contracts/5.x/erc20), [eventi Solidity](https://docs.soliditylang.org/en/latest/contracts.html#events), [reti Ethereum](https://ethereum.org/developers/docs/networks/), [QVAC](https://docs.qvac.tether.io/sdk/js-ts-sdk/). Traccia locale: `Traccia 3_ WELFARE.pdf` nella radice del repository.

Per il planner seguire le nuove specifiche AI_E_DATI.md e DATA_PIPELINE.md: aggiornano la precedente ipotesi di sola generazione QVAC e analisi per circoscrizione. La demo concordata usa esclusivamente Hardhat locale; non è previsto un deploy su reti esterne.

Scelta aggiornata: QVAC per embedding e ricerca locale, DeepSeek API per generazione. La ricerca solo testuale e QVAC opzionale sono ipotesi superate. Il modello embedding effettivo richiede ancora verifica di compatibilità.

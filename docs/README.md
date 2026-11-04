# Documentazione tecnica — Riciclo Solidale

- [Avvio e guida operativa](AVVIO.md): token locale, API, wallet, reset e test su Hardhat.

- [Implementazione del modulo operativo](IMPLEMENTAZIONE.md): stack, contratto, wallet, macchinetta, supermercato, API e test.
- [Interfaccia per il collega: planner e AI](INTERFACCIA_PLANNER.md): eventi, indicizzazione, aggregati e collegamento ai dataset WELFARE.

Le specifiche definiscono i contratti di comportamento; il modulo operativo è implementato e dispone di test automatici. Il lavoro usa esclusivamente Hardhat locale, con reset e test ripetibili. Mantengono separate la simulazione operativa e l'analisi territoriale.

Riferimenti: [OpenZeppelin ERC20](https://docs.openzeppelin.com/contracts/5.x/erc20), [eventi Solidity](https://docs.soliditylang.org/en/latest/contracts.html#events), [reti Ethereum](https://ethereum.org/developers/docs/networks/), [QVAC](https://docs.qvac.tether.io/sdk/js-ts-sdk/). Traccia locale: `Traccia 3_ WELFARE.pdf` nella radice del repository.

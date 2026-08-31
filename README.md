# fsm_rede — Model 1: Fully Decentralized FSM

Part of the MSc dissertation *"Dynamic Smart Contracts for Autonomous Agent Coordination."* This repo implements **Model 1**: three mission scenarios (failure response, formation keeping, reconnaissance leader election) as plain, non-upgradeable Solidity contracts, each driven by an explicit on-chain state machine. It is the baseline against which the other two models are compared:

- Model 2 (proxy/UUPS upgradeability): [`proxy_rede`](https://github.com/carlosfglopes/proxy_rede)
- Model 3 (hybrid): [`hibrido_rede`](https://github.com/carlosfglopes/hibrido_rede)

## Setup

```bash
cd rede_uav && docker compose up -d      # starts the local Besu (IBFT2) network
cd ../smartcontracts && npm install
export RPC_URL=http://127.0.0.1:8545     # or the network's actual RPC endpoint
export PRIVATE_KEY=0x...                 # authority account
```

## Contracts (`smartcontracts/contracts/`)

| File | What it does |
|---|---|
| `MissionFail.sol` | Failure detection and quorum voting FSM: UAVs heartbeat, the authority opens an incident on timeout/misbehavior, peers vote, the mission reconfigures or degrades. |
| `MissionFormation.sol` | Formation keeping FSM: tracks each UAV's distance to the swarm centroid, votes on violations, degrades/recovers the mission. |
| `MissionRecon.sol` | Reconnaissance leader election FSM: scores UAVs by battery/speed, elects a leader on-chain, collects the mission report, re-elects on timeout. |

## Scripts (`smartcontracts/scripts/`)

| File | What it does | Command |
|---|---|---|
| `deploy_mfail.js` | Deploys `MissionFail`. | `npx hardhat run scripts/deploy_mfail.js --network rede_uav` |
| `deploy_mformation.js` | Deploys `MissionFormation`. | `npx hardhat run scripts/deploy_mformation.js --network rede_uav` |
| `deploy_mrecon.js` | Deploys `MissionRecon`. | `npx hardhat run scripts/deploy_mrecon.js --network rede_uav` |
| `fund_uavs.js` | Sends ETH from the authority to the simulated UAV accounts (run once first). | `npx hardhat run scripts/fund_uavs.js --network rede_uav` |
| `simulate_missionfail.js` | Runs a full failure/vote/reconfigure scenario. | `npx hardhat run scripts/simulate_missionfail.js --network rede_uav` |
| `simulate_missionformation.js` | Runs a full formation violation/recovery scenario. | `npx hardhat run scripts/simulate_missionformation.js --network rede_uav` |
| `simulate_missionrecon.js` | Runs a full election/report scenario. | `npx hardhat run scripts/simulate_missionrecon.js --network rede_uav` |
| `reset_missionfail.js` | Resets `MissionFail` to SETUP. | `npx hardhat run scripts/reset_missionfail.js --network rede_uav` |
| `reset_missionformation.js` | Resets `MissionFormation` to SETUP. | `npx hardhat run scripts/reset_missionformation.js --network rede_uav` |
| `reset_missionrecon.js` | Resets `MissionRecon` to IDLE. | `npx hardhat run scripts/reset_missionrecon.js --network rede_uav` |
| `reset_nonce.js` | Cancels pending txs blocking the authority's nonce. | `npx hardhat run scripts/reset_nonce.js --network rede_uav` |

## Authority & agent scripts (Python)

| File | What it does | Command |
|---|---|---|
| `smartcontracts/authority.py` | Authority for `MissionRecon`: registers UAVs, runs the election, drives it to a report. | `PRIVATE_KEY=0x... CONTRACT_ADDRESS=0x... python3 authority.py` |
| `smartcontracts/authority_mfail.py` | Authority for `MissionFail`: drives the failure-detection mission lifecycle. | `CONTRACT_ADDRESS=0x... python3 authority_mfail.py` |
| `smartcontracts/authority_mformation.py` | Authority for `MissionFormation`: registers UAVs, monitors formation. | `CONTRACT_ADDRESS=0x... python3 authority_mformation.py` |
| `agent_mfail.py` | Autonomous UAV agent, one instance per Raspberry Pi: heartbeats and votes. | `UAV_ID=UAV1 PRIVATE_KEY=0x... CONTRACT_ADDRESS=0x... python3 agent_mfail.py` |
| `smartcontracts/metrics.py` | Shared metrics-collection module (imported, not run directly). | — |
| `smartcontracts/full_abis.py` | Full contract ABIs for tx decoding (imported, not run directly). | — |

## Citation

If you use this code, please cite the dissertation this repository accompanies (Carlos Gollwitzer Lopes, *"Dynamic Smart Contracts for Autonomous Agent Coordination,"* Escola Naval).

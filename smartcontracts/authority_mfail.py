#!/usr/bin/env python3
"""
Authority script — MissionFail. Runs on the PC and drives the failure-detection
mission lifecycle (register UAVs, start, open/resolve incidents, reconfigure).

Usage:
    CONTRACT_ADDRESS=0x... python3 authority_mfail.py

Environment variables:
    RPC_URL          (default: http://192.168.1.101:8545)
    PRIVATE_KEY      (default: authority key from genesis)
    CONTRACT_ADDRESS (required)
"""

import os
import sys
import time
import hashlib
from web3 import Web3
from metrics import track_authority_tx, finish_and_save_metrics
from full_abis import FULL_FAIL_ABI

# Configuration
RPC_URL          = os.getenv("RPC_URL", "http://192.168.1.101:8545")
PRIVATE_KEY      = os.getenv("PRIVATE_KEY", "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS")
POLL_INTERVAL    = 2

UAV_ADDRESSES = [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
]
UAV_CAPACITIES = [2, 2, 2, 2]

INITIAL_TASKS = [
    (1, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"),
    (2, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
    (3, "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"),
    (4, "0x90F79bf6EB2c4f870365E785982E1f101E93b906"),
]

SIMULATE_DELAY    = 30
SIMULATE_TARGET   = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"
HEARTBEAT_TIMEOUT = 15

MISSION_STATES = {
    0: "SETUP", 1: "ACTIVE", 2: "UNDER_CONFIRMATION",
    3: "RECONFIGURING", 4: "ACTIVE_RECONFIGURED", 5: "DEGRADED", 6: "ABORTED",
    7: "COMPLETED"
}

# ABI
ABI = [
    {"inputs": [], "name": "missionState",
     "outputs": [{"type": "uint8"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"type": "address"}], "name": "uavs",
     "outputs": [
         {"name": "registered",    "type": "bool"},
         {"name": "state",         "type": "uint8"},
         {"name": "lastHeartbeat", "type": "uint256"},
         {"name": "capacityMax",   "type": "uint256"},
         {"name": "loadCurrent",   "type": "uint256"},
     ], "stateMutability": "view", "type": "function"},
    {"inputs": [{"name": "_uav", "type": "address"}, {"name": "_capacityMax", "type": "uint256"}],
     "name": "registerUAV", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "taskId", "type": "uint256"}, {"name": "assignedTo", "type": "address"}],
     "name": "createTask", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "startMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_suspect", "type": "address"}, {"name": "_evidenceHash", "type": "bytes32"}],
     "name": "openBehaviorIncident", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_suspect", "type": "address"}, {"name": "_evidenceHash", "type": "bytes32"}],
     "name": "detectMissingHeartbeat", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "finalizeIncident",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "triggerReconfiguration",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "taskId", "type": "uint256"}],
     "name": "completeTask", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "reason", "type": "string"}],
     "name": "abortMission", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "completeMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "heartbeatTimeoutSec",
     "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "quorumThreshold",
     "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "votesForFailed",
     "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "votesForByzantine",
     "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "votesReject",
     "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "getMissionSummary",
     "outputs": [
         {"name": "state",       "type": "uint8"},
         {"name": "formation",   "type": "uint8"},
         {"name": "failures",    "type": "uint256"},
         {"name": "activeUAVs",  "type": "uint256"},
         {"name": "activeTasks", "type": "uint256"},
         {"name": "suspect",     "type": "address"},
         {"name": "reason",      "type": "uint8"},
         {"name": "vFailed",     "type": "uint256"},
         {"name": "vByzantine",  "type": "uint256"},
         {"name": "vReject",     "type": "uint256"},
     ], "stateMutability": "view", "type": "function"},
]

# Helpers

def log(msg):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] [AUTHORITY] {msg}", flush=True)

def sep(label=""):
    print(f"\n{'─'*50}")
    if label:
        print(f"  {label}")
    print("─"*50)

def send_tx(w3, account, fn):
    tx = fn.build_transaction({
        "from":                 account.address,
        "nonce":                w3.eth.get_transaction_count(account.address),
        "gas":                  400000,
        "maxFeePerGas":         w3.to_wei("2", "gwei"),
        "maxPriorityFeePerGas": w3.to_wei("1", "gwei"),
    })
    signed  = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    track_authority_tx(receipt, fn.fn_name)
    return receipt

# Main

def main():
    if not CONTRACT_ADDRESS:
        print("ERROR: set CONTRACT_ADDRESS"); sys.exit(1)

    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        print(f"ERROR: cannot connect to {RPC_URL}"); sys.exit(1)

    account  = w3.eth.account.from_key(PRIVATE_KEY)
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(CONTRACT_ADDRESS),
        abi=ABI
    )
    from_block = w3.eth.block_number

    sep("AUTHORITY — MissionFail")
    log(f"RPC      : {RPC_URL}")
    log(f"Authority: {account.address}")
    log(f"Contract : {CONTRACT_ADDRESS}")

    sep("STEP 1 — Register UAVs")
    for addr, cap in zip(UAV_ADDRESSES, UAV_CAPACITIES):
        data = contract.functions.uavs(Web3.to_checksum_address(addr)).call()
        if not data[0]:
            r = send_tx(w3, account, contract.functions.registerUAV(
                Web3.to_checksum_address(addr), cap
            ))
            log(f"Registered: {addr[:10]}... cap={cap} | Block #{r.blockNumber}")
        else:
            log(f"Already registered: {addr[:10]}...")

    sep("STEP 2 — Create Tasks")
    for task_id, assigned_to in INITIAL_TASKS:
        r = send_tx(w3, account, contract.functions.createTask(
            task_id, Web3.to_checksum_address(assigned_to)
        ))
        log(f"Task {task_id} → {assigned_to[:10]}... | Block #{r.blockNumber}")

    sep("STEP 3 — Start Mission")
    r = send_tx(w3, account, contract.functions.startMission())
    log(f"Mission started! Block #{r.blockNumber}")

    sep(f"STEP 4 — Normal Phase ({SIMULATE_DELAY}s)")
    log(f"UAVs sending heartbeats. Simulating a failure of {SIMULATE_TARGET[:10]}... in {SIMULATE_DELAY}s")
    time.sleep(SIMULATE_DELAY)

    sep("STEP 5 — Open Incident (Malicious Behavior on UAV4)")
    evidence = hashlib.sha256(f"byzantine-evidence-{time.time()}".encode()).digest()
    r = send_tx(w3, account, contract.functions.openBehaviorIncident(
        Web3.to_checksum_address(SIMULATE_TARGET), evidence
    ))
    log(f"Incident opened! Suspect: {SIMULATE_TARGET[:10]}... | Block #{r.blockNumber}")

    sep("STEP 6 — Wait for Votes")
    quorum = contract.functions.quorumThreshold().call()
    log(f"Quorum required: {quorum}")

    while True:
        summary = contract.functions.getMissionSummary().call()
        state = summary[0]
        vf, vb, vr = summary[7], summary[8], summary[9]
        log(f"State: {MISSION_STATES.get(state)} | Votes — Failed:{vf} Byzantine:{vb} Reject:{vr}")

        if state == 2:
            if vf >= quorum or vb >= quorum or vr >= quorum:
                log("Quorum reached! Finalizing incident...")
                r = send_tx(w3, account, contract.functions.finalizeIncident())
                log(f"Incident finalized! Block #{r.blockNumber}")
                break
        else:
            break

        time.sleep(POLL_INTERVAL)

    sep("STEP 7 — Reconfigure")
    summary = contract.functions.getMissionSummary().call()
    if summary[0] == 3:
        r = send_tx(w3, account, contract.functions.triggerReconfiguration())
        log(f"Reconfiguration executed! Block #{r.blockNumber}")

    sep("STEP 8 — Final Monitoring")
    finished = False
    for _ in range(10):
        summary = contract.functions.getMissionSummary().call()
        state = summary[0]
        log(f"State: {MISSION_STATES.get(state)} | Failures: {summary[2]} | Active UAVs: {summary[3]} | Tasks: {summary[4]}")
        if state == 6:
            log("Mission ABORTED.")
            finished = True
            break
        time.sleep(POLL_INTERVAL)

    if not finished:
        summary = contract.functions.getMissionSummary().call()
        state = summary[0]
        if state in (1, 4, 5):
            log("Mission healthy with no new failures — closing with completeMission()...")
            r = send_tx(w3, account, contract.functions.completeMission())
            log(f"Mission COMPLETED! Block #{r.blockNumber}")
        else:
            log(f"Mission ended in unexpected state: {MISSION_STATES.get(state)}")

    sep("METRICS")
    finish_and_save_metrics(w3, CONTRACT_ADDRESS, FULL_FAIL_ABI, from_block,
                             model="Modelo1-FSM", scenario="Fail", log=log)

    sep("END")


if __name__ == "__main__":
    main()

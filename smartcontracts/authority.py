#!/usr/bin/env python3
"""
Authority script — MissionRecon. Runs on the PC: registers UAVs, starts the
mission, runs the leader-election flow, and drives it to a final report.

Usage:
    pip install web3
    py authority.py

Environment variables (or edit directly below):
    RPC_URL          (default: http://192.168.1.101:8545)
    PRIVATE_KEY      (default: authority key from genesis)
    CONTRACT_ADDRESS (required)
"""

import os
import sys
import time
from web3 import Web3
from metrics import track_authority_tx, finish_and_save_metrics
from full_abis import FULL_RECON_ABI

# Configuration
RPC_URL          = os.getenv("RPC_URL", "http://192.168.1.101:8545")
PRIVATE_KEY      = os.getenv("PRIVATE_KEY", "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS")

UAV_ADDRESSES = [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
]

MISSION_ZONE = "Zone-Alpha"
POLL_INTERVAL = 2

# ABI
ABI = [
    {
        "inputs": [], "name": "missionState",
        "outputs": [{"type": "uint8"}],
        "stateMutability": "view", "type": "function"
    },
    {
        "inputs": [], "name": "getRegisteredUAVCount",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view", "type": "function"
    },
    {
        "inputs": [{"type": "address"}], "name": "uavs",
        "outputs": [
            {"name": "permitted",   "type": "bool"},
            {"name": "registered",  "type": "bool"},
            {"name": "hasStatus",   "type": "bool"},
            {"name": "ineligible",  "type": "bool"},
            {"name": "battery",     "type": "uint256"},
            {"name": "speed",       "type": "uint256"},
            {"name": "score",       "type": "uint256"},
        ],
        "stateMutability": "view", "type": "function"
    },
    {
        "inputs": [{"name": "_uav", "type": "address"}], "name": "permitUAV",
        "outputs": [], "stateMutability": "nonpayable", "type": "function"
    },
    {
        "inputs": [{"name": "_zone", "type": "string"}], "name": "activateMission",
        "outputs": [], "stateMutability": "nonpayable", "type": "function"
    },
    {
        "inputs": [], "name": "startElection",
        "outputs": [], "stateMutability": "nonpayable", "type": "function"
    },
    {
        "inputs": [], "name": "electedLeader",
        "outputs": [{"type": "address"}],
        "stateMutability": "view", "type": "function"
    },
    {
        "inputs": [], "name": "getMissionSummary",
        "outputs": [
            {"name": "state",        "type": "uint8"},
            {"name": "zone",         "type": "string"},
            {"name": "leader",       "type": "address"},
            {"name": "reelections",  "type": "uint256"},
            {"name": "report",       "type": "uint8"},
            {"name": "evidenceHash", "type": "bytes32"},
        ],
        "stateMutability": "view", "type": "function"
    },
    {
        "inputs": [], "name": "minUAVsForElection",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view", "type": "function"
    },
]

STATE_NAMES  = {0:"IDLE",1:"ACTIVE",2:"ELECTION",3:"ASSIGNED",4:"REPORTING",5:"COMPLETED",6:"FAILED",7:"TERMINATED"}
REPORT_NAMES = {0:"NONE",1:"TARGET_DETECTED",2:"NOTHING_FOUND",3:"INCONCLUSIVE"}

# Helpers

def log(msg):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] [AUTHORITY] {msg}", flush=True)

def send_tx(w3, account, fn):
    tx = fn.build_transaction({
        "from":                account.address,
        "nonce":               w3.eth.get_transaction_count(account.address),
        "gas":                 300000,
        "maxFeePerGas":        w3.to_wei("2", "gwei"),
        "maxPriorityFeePerGas": w3.to_wei("1", "gwei"),
    })
    signed  = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    track_authority_tx(receipt, fn.fn_name)
    return receipt

def sep(label=""):
    print(f"\n{'─'*50}")
    if label:
        print(f"  {label}")
    print("─"*50)

# Main

def main():
    if not CONTRACT_ADDRESS:
        print("ERROR: set the CONTRACT_ADDRESS variable"); sys.exit(1)

    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        print(f"ERROR: cannot connect to {RPC_URL}"); sys.exit(1)

    account  = w3.eth.account.from_key(PRIVATE_KEY)
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(CONTRACT_ADDRESS),
        abi=ABI
    )
    from_block = w3.eth.block_number

    sep("AUTHORITY — MissionRecon")
    log(f"RPC      : {RPC_URL}")
    log(f"Authority: {account.address}")
    log(f"Contract : {CONTRACT_ADDRESS}")
    log(f"UAVs     : {len(UAV_ADDRESSES)}")

    sep("STEP 1 — Permit UAVs")
    for addr in UAV_ADDRESSES:
        uav_data = contract.functions.uavs(Web3.to_checksum_address(addr)).call()
        if not uav_data[0]:
            r = send_tx(w3, account, contract.functions.permitUAV(Web3.to_checksum_address(addr)))
            log(f"Permitted: {addr} | Block #{r.blockNumber}")
        else:
            log(f"Already permitted: {addr}")

    sep("STEP 2 — Activate Mission")
    state = contract.functions.missionState().call()
    if state == 0:
        r = send_tx(w3, account, contract.functions.activateMission(MISSION_ZONE))
        log(f"Mission activated: {MISSION_ZONE} | Block #{r.blockNumber}")
    else:
        log(f"Mission already in state: {STATE_NAMES.get(state)}")

    sep("STEP 3 — Wait for UAV registration and status")
    min_uavs = contract.functions.minUAVsForElection().call()
    log(f"Minimum UAVs required: {min_uavs}")

    while True:
        state = contract.functions.missionState().call()
        if state != 1:
            break

        ready = 0
        for addr in UAV_ADDRESSES:
            data = contract.functions.uavs(Web3.to_checksum_address(addr)).call()
            if data[1] and data[2]:
                ready += 1

        log(f"UAVs ready: {ready}/{len(UAV_ADDRESSES)}")

        if ready >= min_uavs:
            log("Enough UAVs ready!")
            break

        time.sleep(POLL_INTERVAL)

    sep("STEP 4 — Start Election")
    state = contract.functions.missionState().call()
    if state == 1:
        r = send_tx(w3, account, contract.functions.startElection())
        log(f"Election started! Block #{r.blockNumber}")
        leader = contract.functions.electedLeader().call()
        log(f"Elected leader: {leader}")
    else:
        log(f"Unexpected state: {STATE_NAMES.get(state)}")

    sep("STEP 5 — Monitoring")
    while True:
        try:
            summary = contract.functions.getMissionSummary().call()
            state   = summary[0]
            log(f"State: {STATE_NAMES.get(state)} | Leader: {summary[2][:10]}... | Re-elections: {summary[3]}")

            if state in (5, 6, 7):
                sep("FINAL RESULT")
                log(f"State        : {STATE_NAMES.get(state)}")
                log(f"Leader       : {summary[2]}")
                log(f"Report       : {REPORT_NAMES.get(summary[4], str(summary[4]))}")
                log(f"Re-elections : {summary[3]}")
                log(f"Evidence Hash: 0x{summary[5].hex()}")
                break

        except Exception as e:
            log(f"Error: {e}")

        time.sleep(POLL_INTERVAL)

    sep("METRICS")
    finish_and_save_metrics(w3, CONTRACT_ADDRESS, FULL_RECON_ABI, from_block,
                             model="Modelo1-FSM", scenario="Recon", log=log)

    sep("END")


if __name__ == "__main__":
    main()

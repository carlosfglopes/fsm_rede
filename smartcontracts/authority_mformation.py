#!/usr/bin/env python3
"""
Authority script — MissionFormation. Runs on the PC: registers UAVs, starts the
mission, and monitors formation-keeping (violations, degrade/recover cycles).

Usage:
    CONTRACT_ADDRESS=0x... python3 authority_mformation.py

Environment variables:
    RPC_URL          (default: http://192.168.1.101:8545)
    PRIVATE_KEY      (default: authority key from genesis)
    CONTRACT_ADDRESS (required)
"""

import os
import sys
import time
from web3 import Web3
from metrics import track_authority_tx, finish_and_save_metrics
from full_abis import FULL_FORMATION_ABI

# Configuration
RPC_URL          = os.getenv("RPC_URL", "http://192.168.1.101:8545")
PRIVATE_KEY      = os.getenv("PRIVATE_KEY", "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS")
POLL_INTERVAL    = 2
MISSION_DURATION = 45

UAV_SETUP = [
    {"address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "x": 0,    "y": 0},
    {"address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "x": 2000, "y": 0},
    {"address": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", "x": 4000, "y": 0},
    {"address": "0x90F79bf6EB2c4f870365E785982E1f101E93b906", "x": 6000, "y": 0},
]

MISSION_STATES = {
    0: "SETUP", 1: "ACTIVE", 2: "RECONFIGURING_FORMATION",
    3: "DEGRADED", 4: "COMPLETED", 5: "ABORTED"
}

# ABI
ABI = [
    {"inputs": [], "name": "missionState",
     "outputs": [{"type": "uint8"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"type": "address"}], "name": "uavs",
     "outputs": [
         {"name": "registered",     "type": "bool"},
         {"name": "state",          "type": "uint8"},
         {"name": "x",              "type": "int256"},
         {"name": "y",              "type": "int256"},
         {"name": "lastUpdate",     "type": "uint256"},
         {"name": "violationCount", "type": "uint256"},
     ], "stateMutability": "view", "type": "function"},
    {"inputs": [
         {"name": "_uav", "type": "address"},
         {"name": "_x",   "type": "int256"},
         {"name": "_y",   "type": "int256"},
     ], "name": "registerUAV", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "startMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "checkLateUAVs",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "completeMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "reason", "type": "string"}],
     "name": "abortMission", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "getSwarmSummary",
     "outputs": [
         {"name": "state",              "type": "uint8"},
         {"name": "formationId",        "type": "uint256"},
         {"name": "cx",                 "type": "int256"},
         {"name": "cy",                 "type": "int256"},
         {"name": "totalUAVs",          "type": "uint256"},
         {"name": "inTransition",       "type": "bool"},
         {"name": "transitionSecsLeft", "type": "uint256"},
     ], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "getSwarmCounts",
     "outputs": [
         {"name": "okCount",             "type": "uint256"},
         {"name": "lateCount",           "type": "uint256"},
         {"name": "outOfFormationCount", "type": "uint256"},
         {"name": "inactiveCount",       "type": "uint256"},
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

    sep("AUTHORITY — MissionFormation")
    log(f"RPC      : {RPC_URL}")
    log(f"Authority: {account.address}")
    log(f"Contract : {CONTRACT_ADDRESS}")

    sep("STEP 1 — Register UAVs")
    for uav in UAV_SETUP:
        addr = Web3.to_checksum_address(uav["address"])
        data = contract.functions.uavs(addr).call()
        if not data[0]:
            r = send_tx(w3, account, contract.functions.registerUAV(
                addr, uav["x"], uav["y"]
            ))
            log(f"Registered: {uav['address'][:10]}... pos=({uav['x']},{uav['y']}) | Block #{r.blockNumber}")
        else:
            log(f"Already registered: {uav['address'][:10]}...")

    sep("STEP 2 — Start Mission")
    r = send_tx(w3, account, contract.functions.startMission())
    log(f"Mission started! Block #{r.blockNumber}")

    sep(f"STEP 3 — Monitor Formation ({MISSION_DURATION}s)")
    start = time.time()
    check_late_interval = 10
    last_check_late = 0

    while time.time() - start < MISSION_DURATION:
        try:
            summary = contract.functions.getSwarmSummary().call()
            counts  = contract.functions.getSwarmCounts().call()
            state   = summary[0]

            elapsed = int(time.time() - start)
            log(f"[{elapsed}s] State: {MISSION_STATES.get(state)} | "
                f"Centroid:({summary[2]},{summary[3]}) | "
                f"OK:{counts[0]} Late:{counts[1]} OutForm:{counts[2]}")

            now = time.time()
            if now - last_check_late >= check_late_interval:
                if state in (1, 2, 3):
                    send_tx(w3, account, contract.functions.checkLateUAVs())
                    log("checkLateUAVs() executed")
                    last_check_late = now

            if state in (4, 5):
                log(f"Mission ended: {MISSION_STATES.get(state)}")
                break

        except Exception as e:
            log(f"Error: {e}")

        time.sleep(POLL_INTERVAL)

    sep("STEP 4 — Complete Mission")
    state = contract.functions.missionState().call()
    if state in (1, 3):
        r = send_tx(w3, account, contract.functions.completeMission())
        log(f"Mission completed! Block #{r.blockNumber}")
    else:
        log(f"Current state: {MISSION_STATES.get(state)} — no action")

    sep("FINAL RESULT")
    summary = contract.functions.getSwarmSummary().call()
    counts  = contract.functions.getSwarmCounts().call()
    log(f"State       : {MISSION_STATES.get(summary[0])}")
    log(f"Formation ID: {summary[1]}")
    log(f"Centroid    : ({summary[2]}, {summary[3]})")
    log(f"UAVs OK     : {counts[0]}")
    log(f"Late        : {counts[1]}")
    log(f"Out of Form.: {counts[2]}")
    log(f"Inactive    : {counts[3]}")

    sep("METRICS")
    finish_and_save_metrics(w3, CONTRACT_ADDRESS, FULL_FORMATION_ABI, from_block,
                             model="Modelo1-FSM", scenario="Formation", log=log)

    sep("END")


if __name__ == "__main__":
    main()

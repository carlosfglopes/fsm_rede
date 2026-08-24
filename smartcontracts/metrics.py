#!/usr/bin/env python3
"""
Shared metrics-collection module used by the authority.py / authority_mfail.py /
authority_mformation.py scripts (Model 1). Writes results to the SAME shared
CSVs as the JS scripts in Models 2 and 3 (identical schema), so they can be
consolidated together regardless of the model/scenario/language that
generated them.

Not run directly — imported by the authority scripts.

Typical usage inside an authority*.py script:

    from metrics import track_authority_tx, finish_and_save_metrics

    from_block = w3.eth.block_number
    ...
    def send_tx(w3, account, fn, label="?"):
        ...
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        track_authority_tx(receipt, label)
        return receipt
    ...
    finish_and_save_metrics(w3, CONTRACT_ADDRESS, FULL_ABI, from_block,
                             model="Modelo1-FSM", scenario="Recon", log=log)
"""

import os
import csv
import time
from datetime import datetime, timezone
from web3.middleware import ExtraDataToPOAMiddleware

METRICS_DIR = r"C:\Users\Escola Naval\Documents\Claude\Projects\Dissertação\metricas"
OPS_CSV  = os.path.join(METRICS_DIR, "resultados_operacoes.csv")
RUNS_CSV = os.path.join(METRICS_DIR, "resultados_missao.csv")

OPS_HEADER  = ["timestamp", "modelo", "cenario", "run_id", "proxy", "funcao", "origem",
               "n_chamadas", "gas_total", "gas_medio", "reverted"]
RUNS_HEADER = ["timestamp", "modelo", "cenario", "run_id", "proxy", "from_block", "to_block",
               "n_blocos", "duracao_segundos", "n_tx_total", "gas_total", "remetentes_unicos", "remetentes_lista"]

_authority_records = []
_authority_tx_hashes = set()


def _ensure_csv(path, header):
    os.makedirs(METRICS_DIR, exist_ok=True)
    if not os.path.exists(path):
        with open(path, "w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(header)


def reset_accumulator():
    global _authority_records, _authority_tx_hashes
    _authority_records = []
    _authority_tx_hashes = set()


def track_authority_tx(receipt, label):
    function_name = label.split(" ")[0].split("(")[0]
    tx_hash = receipt.transactionHash.hex()
    _authority_records.append({
        "functionName": function_name,
        "sender": receipt["from"].lower(),
        "gasUsed": int(receipt.gasUsed),
        "blockNumber": int(receipt.blockNumber),
        "status": int(receipt.status),
        "source": "authority",
    })
    _authority_tx_hashes.add(tx_hash.lower())


def scan_agent_tx(w3, proxy_address, contract, from_block, to_block):
    records = []
    proxy_lower = proxy_address.lower()

    for bn in range(from_block, to_block + 1):
        try:
            block = w3.eth.get_block(bn, full_transactions=True)
        except Exception as e:
            print(f"[WARN] scan_agent_tx: failed to read block {bn}: {e}")
            continue
        for tx in block.transactions:
            if not tx.to or tx.to.lower() != proxy_lower:
                continue
            if tx.hash.hex().lower() in _authority_tx_hashes:
                continue

            function_name = "unknown"
            try:
                func_obj, _params = contract.decode_function_input(tx.input)
                function_name = func_obj.fn_name
            except Exception:
                pass

            try:
                receipt = w3.eth.get_transaction_receipt(tx.hash)
            except Exception:
                continue

            records.append({
                "functionName": function_name,
                "sender": tx["from"].lower(),
                "gasUsed": int(receipt.gasUsed),
                "blockNumber": int(receipt.blockNumber),
                "status": int(receipt.status),
                "source": "agente",
            })
    return records


def finish_and_save_metrics(w3, proxy_address, full_abi, from_block, model, scenario, log=None):
    try:
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    except ValueError:
        pass

    to_block = w3.eth.block_number
    contract = w3.eth.contract(address=w3.to_checksum_address(proxy_address), abi=full_abi)
    agent_records = scan_agent_tx(w3, proxy_address, contract, from_block, to_block)
    records = _authority_records + agent_records

    from_block_data = w3.eth.get_block(from_block)
    to_block_data = w3.eth.get_block(to_block)
    duration_seconds = int(to_block_data.timestamp) - int(from_block_data.timestamp)

    run_id = str(int(time.time() * 1000))
    ts = datetime.now(timezone.utc).isoformat()

    by_function = {}
    senders = set()
    total_gas = 0
    total_reverted = 0

    for r in records:
        senders.add(r["sender"])
        total_gas += r["gasUsed"]
        if r["status"] == 0:
            total_reverted += 1
        key = (r["functionName"], r["source"])
        if key not in by_function:
            by_function[key] = {"functionName": r["functionName"], "source": r["source"], "count": 0, "gasSum": 0}
        by_function[key]["count"] += 1
        by_function[key]["gasSum"] += r["gasUsed"]

    _ensure_csv(OPS_CSV, OPS_HEADER)
    _ensure_csv(RUNS_CSV, RUNS_HEADER)

    with open(OPS_CSV, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        for f_ in by_function.values():
            w.writerow([ts, model, scenario, run_id, proxy_address, f_["functionName"], f_["source"],
                        f_["count"], f_["gasSum"], round(f_["gasSum"] / f_["count"]), ""])

    with open(RUNS_CSV, "a", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow([ts, model, scenario, run_id, proxy_address, from_block, to_block,
                                 to_block - from_block + 1, duration_seconds, len(records), total_gas, len(senders),
                                 ";".join(sorted(senders))])

    summary = {
        "runId": run_id, "fromBlock": from_block, "toBlock": to_block,
        "durationSeconds": duration_seconds,
        "totalTx": len(records), "totalGas": total_gas,
        "uniqueSenders": len(senders), "totalReverted": total_reverted,
        "byFunction": sorted(by_function.values(), key=lambda x: -x["gasSum"]),
    }

    if log:
        log(f"Blocks: {from_block}->{to_block} ({to_block - from_block + 1}) | "
            f"Duration: {duration_seconds}s | "
            f"Total tx: {summary['totalTx']} | Total gas: {summary['totalGas']} | "
            f"Unique senders: {summary['uniqueSenders']} | Reverted: {summary['totalReverted']}")
        for f_ in summary["byFunction"]:
            log(f"  {f_['functionName']} ({f_['source']}): {f_['count']}x | "
                f"total gas {f_['gasSum']} | avg gas {round(f_['gasSum']/f_['count'])}")
        log(f"CSV: {OPS_CSV}")
        log(f"CSV: {RUNS_CSV}")

    reset_accumulator()
    return summary

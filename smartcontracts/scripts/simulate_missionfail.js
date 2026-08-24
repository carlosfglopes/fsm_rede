// scripts/simulate_missionfail.js
// Runs a full end-to-end scenario against the deployed MissionFail contract
// (register UAVs, start mission, trigger a failure incident, vote, reconfigure).
//
// Usage:
//   npx hardhat run scripts/simulate_missionfail.js --network rede_uav

//   SCENARIO=byzantine npx hardhat run scripts/simulate_missionfail.js --network rede_uav
//   $env:SCENARIO="byzantine"; npx hardhat run scripts/simulate_missionfail.js --network rede_uav

//   SCENARIO=abort     npx hardhat run scripts/simulate_missionfail.js --network rede_uav
//   $env:SCENARIO="abort"; npx hardhat run scripts/simulate_missionfail.js --network rede_uav

//   SCENARIO=reject    npx hardhat run scripts/simulate_missionfail.js --network rede_uav
//   $env:SCENARIO="reject"; npx hardhat run scripts/simulate_missionfail.js --network rede_uav


const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

// CONFIGURATION
const SCENARIO = process.env.SCENARIO || "heartbeat_fail";

const UAV_PROFILES = [
  { capacityMax: 2 },
  { capacityMax: 2 },
  { capacityMax: 2 },
];

const TASK_ASSIGNMENTS = [
  { taskId: 1, uavIndex: 0 },
  { taskId: 2, uavIndex: 1 },
  { taskId: 3, uavIndex: 2 },
];

const GAS = {
  gasLimit            : 3000000,
  maxFeePerGas        : 2000000000,
  maxPriorityFeePerGas: 1000000000,
};

const UAV_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
];

// HELPERS

async function increaseTime(seconds) {
  try {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine");
  } catch (e) {
    if (e.message && e.message.includes("Method not found")) {
      console.log(`  (real network: waiting ${seconds}s in real time...)`);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    } else {
      throw e;
    }
  }
}

function keccak256(str) {
  const bytes = Buffer.from(str, "utf8");
  if (typeof hre.ethers.utils !== "undefined") return hre.ethers.utils.keccak256(bytes);
  return hre.ethers.keccak256(bytes);
}

function missionStateLabel(v) {
  const l = { 0:"SETUP", 1:"ACTIVE", 2:"UNDER_CONFIRMATION", 3:"RECONFIGURING",
              4:"ACTIVE_RECONFIGURED", 5:"DEGRADED", 6:"ABORTED" };
  return l[Number(v)] ?? `UNKNOWN(${v})`;
}

function uavStateLabel(v) {
  const l = { 0:"UNREGISTERED", 1:"ACTIVE", 2:"SUSPECT",
              3:"CONFIRMED_FAILED", 4:"CONFIRMED_BYZANTINE", 5:"REMOVED" };
  return l[Number(v)] ?? `UNKNOWN(${v})`;
}

function reasonLabel(v)    { return ["NONE","NO_HEARTBEAT","MALICIOUS_BEHAVIOR"][Number(v)] ?? `UNKNOWN(${v})`; }
function formationLabel(v) { return ["FULL","REDUCED","MINIMAL"][Number(v)] ?? `UNKNOWN(${v})`; }
function voteLabel(v)      { return ["NONE","CONFIRM_FAILED","CONFIRM_BYZANTINE","REJECT"][Number(v)] ?? `UNKNOWN(${v})`; }

function sep(label) {
  console.log(`\n${"─".repeat(50)}`);
  if (label) console.log(`  ${label}`);
  console.log("─".repeat(50));
}

async function sendTx(txPromise, label) {
  const tx      = await txPromise;
  const receipt = await tx.wait();
  console.log(`  [${label}] gas: ${receipt.gasUsed.toString()} | block: ${receipt.blockNumber}`);
  return receipt;
}

async function printSummary(mission, uavSigners, taskIds) {
  const s = await mission.getMissionSummary();
  console.log("\n  ── Mission State ─────────────────────────");
  console.log("  State      :", missionStateLabel(s.state));
  console.log("  Formation  :", formationLabel(s.formation));
  console.log("  Failures   :", s.failures.toString());
  console.log("  Active UAVs:", s.activeUAVs.toString());
  console.log("  Tasks      :", s.activeTasks.toString());
  if (Number(s.state) === 2) {
    console.log("  Suspect    :", s.suspect);
    console.log("  Reason     :", reasonLabel(s.reason));
    console.log("  Votes      : FAILED=" + s.vFailed + " BYZANTINE=" + s.vByzantine + " REJECT=" + s.vReject);
  }

  console.log("\n  ── UAV State ─────────────────────────────");
  for (const signer of uavSigners) {
    const uav = await mission.uavs(signer.address);
    console.log(`  ${signer.address.slice(0,10)}…  state=${uavStateLabel(uav.state).padEnd(20)} load=${uav.loadCurrent}/${uav.capacityMax}`);
  }

  console.log("\n  ── Tasks ─────────────────────────────────");
  for (const taskId of taskIds) {
    const t = await mission.getTaskSummary(taskId);
    const assignee = t.assignedTo === "0x0000000000000000000000000000000000000000"
      ? "UNASSIGNED"
      : t.assignedTo.slice(0, 10) + "…";
    console.log(`  Task ${taskId}: active=${t.active} → ${assignee}`);
  }
}

// GET CONTRACT

async function getContract(authority) {
  const MissionFail = await hre.ethers.getContractFactory("MissionFail");

  if (process.env.MISSION_ADDRESS) {
    console.log("  Attach via MISSION_ADDRESS:", process.env.MISSION_ADDRESS);
    return MissionFail.attach(process.env.MISSION_ADDRESS);
  }

  const jsonPath = path.join(__dirname, "..", "deployed_mfail.json");
  if (fs.existsSync(jsonPath)) {
    const info = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    if (info.network === hre.network.name) {
      console.log("  Attach via deployed_mfail.json:", info.address);
      return MissionFail.attach(info.address);
    }
  }

  console.log("  No contract found — deploying a new one...");
  const contract = await MissionFail.deploy(
    authority.address,
    15, 2, 2, 2, 0,
    GAS
  );
  const deployTx = typeof contract.deploymentTransaction === "function"
    ? contract.deploymentTransaction() : contract.deployTransaction;
  const receipt = await deployTx.wait();
  const address = contract.address ?? await contract.getAddress();
  console.log("  Deployed at:", address, "| gas:", receipt.gasUsed.toString());
  return contract;
}

// MISSION SETUP

async function setupAndStart(mission, authority, uavSigners) {
  sep("SETUP — Register + Tasks + Start");

  const state = await mission.missionState();
  if (Number(state) !== 0) {
    console.log(`  Current state: ${missionStateLabel(state)} — skipping setup (run reset first if needed)`);
    return;
  }

  for (let i = 0; i < uavSigners.length; i++) {
    const profile = UAV_PROFILES[i];
    await sendTx(
      mission.connect(authority).registerUAV(uavSigners[i].address, profile.capacityMax, GAS),
      `registerUAV [${i + 1}]`
    );
    console.log(`  ✔ UAV${i + 1}: ${uavSigners[i].address} | capacityMax=${profile.capacityMax}`);
  }

  for (const t of TASK_ASSIGNMENTS) {
    await sendTx(
      mission.connect(authority).createTask(t.taskId, uavSigners[t.uavIndex].address, GAS),
      `createTask T${t.taskId}`
    );
    console.log(`  ✔ Task ${t.taskId} → UAV${t.uavIndex + 1}`);
  }

  await sendTx(mission.connect(authority).startMission(GAS), "startMission");
  console.log("  ✔ Mission started → ACTIVE");
}

// COMMON PHASE

async function runIncidentPhase(mission, authority, uavSigners, suspect, reason, evidenceStr, voteChoice, phaseLabel) {
  sep(phaseLabel);

  const evidenceHash = keccak256(evidenceStr);
  const CONFIRM_FAILED    = 1;
  const CONFIRM_BYZANTINE = 2;
  const REJECT            = 3;

  if (reason === "NO_HEARTBEAT") {
    const timeoutSec = Number(await mission.heartbeatTimeoutSec());
    const waitSec    = timeoutSec + 1;
    console.log(`  UAV1 and UAV2 send heartbeat; UAV3 does not`);
    await sendTx(mission.connect(uavSigners[0]).heartbeat(GAS), "heartbeat UAV1");
    await sendTx(mission.connect(uavSigners[1]).heartbeat(GAS), "heartbeat UAV2");
    console.log(`  Waiting for timeout (${waitSec}s)...`);
    await increaseTime(waitSec);
    await sendTx(
      mission.connect(authority).detectMissingHeartbeat(suspect.address, evidenceHash, GAS),
      "detectMissingHeartbeat"
    );
  } else {
    await sendTx(
      mission.connect(authority).openBehaviorIncident(suspect.address, evidenceHash, GAS),
      "openBehaviorIncident"
    );
  }

  const stateAfterDetect = await mission.missionState();
  console.log("  State after detection:", missionStateLabel(stateAfterDetect));
  console.log("  Suspect:", suspect.address);
  console.log("  Reason :", reason);

  sep("VOTING");
  const eligible = Number(await mission.getActiveEligibleVoters());
  console.log("  Eligible voters:", eligible);

  for (const voter of uavSigners) {
    if (voter.address === suspect.address) continue;
    const uav = await mission.uavs(voter.address);
    if (Number(uav.state) !== 1) continue;

    await sendTx(
      mission.connect(voter).voteOnSuspect(voteChoice, GAS),
      `voteOnSuspect ${voteLabel(voteChoice)} [${voter.address.slice(0, 8)}…]`
    );
  }

  const s = await mission.getMissionSummary();
  console.log(`  Votes — FAILED: ${s.vFailed} | BYZANTINE: ${s.vByzantine} | REJECT: ${s.vReject}`);

  await sendTx(mission.connect(authority).finalizeIncident(GAS), "finalizeIncident");
  const stateAfterFinalize = await mission.missionState();
  console.log("  State after finalization:", missionStateLabel(stateAfterFinalize));


  if (Number(stateAfterFinalize) === 3) {
    await sendTx(mission.connect(authority).triggerReconfiguration(GAS), "triggerReconfiguration");
    const stateAfterReconfig = await mission.missionState();
    console.log("  State after reconfiguration:", missionStateLabel(stateAfterReconfig));
  }
}

// SCENARIOS

async function runHeartbeatFailScenario(mission, authority, uavSigners) {
  await runIncidentPhase(
    mission, authority, uavSigners,
    uavSigners[2],
    "NO_HEARTBEAT",
    "evidence-no-heartbeat-uav3",
    1,
    "SCENARIO: HEARTBEAT FAIL"
  );
}

async function runByzantineScenario(mission, authority, uavSigners) {

  sep("HEARTBEATS — Normal State");
  for (let i = 0; i < uavSigners.length; i++) {
    await sendTx(mission.connect(uavSigners[i]).heartbeat(GAS), `heartbeat UAV${i + 1}`);
  }
  console.log("  ✔ All UAVs active");

  await runIncidentPhase(
    mission, authority, uavSigners,
    uavSigners[2],
    "MALICIOUS_BEHAVIOR",
    "evidence-byzantine-behavior-uav3",
    2,
    "SCENARIO: BYZANTINE"
  );
}

async function runAbortScenario(mission, authority, uavSigners) {

  await runIncidentPhase(
    mission, authority, uavSigners,
    uavSigners[2],
    "MALICIOUS_BEHAVIOR",
    "evidence-abort-phase1-uav3",
    1,
    "SCENARIO: ABORT — Phase 1 (UAV3 fails)"
  );

  const stateAfterPhase1 = await mission.missionState();
  console.log("\n  State after Phase 1:", missionStateLabel(stateAfterPhase1));
  console.log("  failureCount:", (await mission.failureCount()).toString());

  if (Number(stateAfterPhase1) === 6) {
    console.log("  Mission already aborted in Phase 1 (threshold reached).");
    return;
  }


  await runIncidentPhase(
    mission, authority, uavSigners,
    uavSigners[1],
    "MALICIOUS_BEHAVIOR",
    "evidence-abort-phase2-uav2",
    1,
    "SCENARIO: ABORT — Phase 2 (UAV2 fails | quorum fallback)"
  );

  const stateAfterPhase2 = await mission.missionState();
  console.log("\n  State after Phase 2:", missionStateLabel(stateAfterPhase2));
  console.log("  failureCount:", (await mission.failureCount()).toString());
}

async function runRejectScenario(mission, authority, uavSigners) {

  sep("HEARTBEATS — Normal State");
  for (let i = 0; i < uavSigners.length; i++) {
    await sendTx(mission.connect(uavSigners[i]).heartbeat(GAS), `heartbeat UAV${i + 1}`);
  }
  console.log("  ✔ False alarm: authority opens incident on UAV3");

  await runIncidentPhase(
    mission, authority, uavSigners,
    uavSigners[2],
    "MALICIOUS_BEHAVIOR",
    "evidence-false-alarm-uav3",
    3,
    "SCENARIO: REJECT (false alarm)"
  );
}

// MAIN

async function main() {
  const [authority] = await hre.ethers.getSigners();
  const provider    = authority.provider ?? hre.ethers.provider;

  const uav1 = new hre.ethers.Wallet(UAV_KEYS[0], provider);
  const uav2 = new hre.ethers.Wallet(UAV_KEYS[1], provider);
  const uav3 = new hre.ethers.Wallet(UAV_KEYS[2], provider);
  const uavSigners = [uav1, uav2, uav3];

  sep("MissionFail — Scenario 2 Simulation");
  console.log("  Network   :", hre.network.name);
  console.log("  Authority :", authority.address);
  console.log("  UAV1      :", uav1.address);
  console.log("  UAV2      :", uav2.address);
  console.log("  UAV3      :", uav3.address);
  console.log("  Scenario  :", SCENARIO);

  const mission = await getContract(authority);

  await setupAndStart(mission, authority, uavSigners);

  if      (SCENARIO === "heartbeat_fail") await runHeartbeatFailScenario(mission, authority, uavSigners);
  else if (SCENARIO === "byzantine")      await runByzantineScenario(mission, authority, uavSigners);
  else if (SCENARIO === "abort")          await runAbortScenario(mission, authority, uavSigners);
  else if (SCENARIO === "reject")         await runRejectScenario(mission, authority, uavSigners);
  else throw new Error(`Invalid scenario: "${SCENARIO}". Use: heartbeat_fail | byzantine | abort | reject`);

  sep("FINAL RESULT");
  const taskIds = TASK_ASSIGNMENTS.map(t => t.taskId);
  await printSummary(mission, uavSigners, taskIds);

  sep("END");
}

main().catch((err) => {
  console.error("✘ Error:", err.message);
  process.exitCode = 1;
});